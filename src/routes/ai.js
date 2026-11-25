import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { parse } from '../lib/validation.js';
import { requireAuth } from '../middleware/auth.js';
import {
  listConversations,
  createConversation,
  getConversation,
  listMessages,
  sendMessage,
  deleteConversation,
  KLYRA_LIMITS,
} from '../services/ai/klyra.js';
import { GEMINI_DEFAULT_MODEL } from '../services/ai/provider.js';
import { extractFileText, extractMaterialText } from '../services/ai/extract.js';

const toIso = (date) => new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z');

const toConversationApi = (row) => ({
  id: row.id,
  title: row.title,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const toMessageApi = (row) => ({
  id: row.id,
  role: row.role,
  content: row.content,
  createdAt: toIso(row.created_at),
});

const sendSchema = z.object({
  content: z
    .string({ error: 'Escreva uma mensagem.' })
    .trim()
    .max(
      KLYRA_LIMITS.maxMessageLength,
      `A mensagem deve ter no máximo ${KLYRA_LIMITS.maxMessageLength} caracteres.`,
    )
    .optional()
    .default(''),
  attachmentName: z.string().trim().max(200).optional(),
  attachmentText: z.string().max(60000).optional(),
});

const createSchema = z.object({
  title: z
    .string()
    .trim()
    .max(120, 'O título deve ter no máximo 120 caracteres.')
    .optional()
    .default('Nova conversa'),
});

export function aiRouter({ db, config }) {
  const router = Router();

  const messageLimiter = config.rateLimit.enabled
    ? rateLimit({
        windowMs: 60 * 1000,
        limit: 12,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        keyGenerator: (req) => `klyra-user-${req.user.id}`,
        message: {
          error: {
            code: 'RATE_LIMITED',
            message: 'Você está enviando mensagens muito rápido. Aguarde um momento.',
          },
        },
      })
    : (_req, _res, next) => next();

  router.use(requireAuth);

  router.get('/conversations', async (req, res) => {
    const rows = await listConversations(db, req.user.id);
    res.json({ items: rows.map(toConversationApi) });
  });

  router.post('/conversations', async (req, res) => {
    const { title } = parse(createSchema, req.body);
    const row = await createConversation(db, req.user.id, title);
    res.status(201).json({ item: toConversationApi(row) });
  });

  router.get('/conversations/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'ID de conversa inválido.' },
      });
    }

    const conversation = await getConversation(db, req.user.id, id);
    const messages = await listMessages(db, req.user.id, id);

    res.json({
      item: toConversationApi(conversation),
      messages: messages.map(toMessageApi),
    });
  });

  router.post('/conversations/:id/messages', messageLimiter, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'ID de conversa inválido.' },
      });
    }

    if (!config.geminiApiKey) {
      return res.status(503).json({
        error: {
          code: 'AI_NOT_CONFIGURED',
          message: 'A Klyra ainda não está disponível. Tente mais tarde.',
        },
      });
    }

    const { content, attachmentName, attachmentText } = parse(sendSchema, req.body);

    try {
      const result = await sendMessage(db, {
        userId: req.user.id,
        conversationId: id,
        content,
        attachmentName,
        attachmentText,
        apiKey: config.geminiApiKey,
        model: config.geminiModel || GEMINI_DEFAULT_MODEL,
      });

      res.status(201).json({
        userMessage: toMessageApi(result.userMessage),
        assistantMessage: toMessageApi(result.assistantMessage),
        remainingToday: result.remainingToday,
        title: result.title || undefined,
      });
    } catch (err) {
      if (err.code === 'RATE_LIMITED' || err.status === 429) {
        return res.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message:
              'A Klyra está recebendo muitas solicitações no momento. Tente novamente em instantes.',
          },
        });
      }
      if (
        err.code === 'AI_PROVIDER_ERROR' ||
        err.code === 'AI_EMPTY_RESPONSE' ||
        err.code === 'AI_TIMEOUT'
      ) {
        return res.status(err.status === 504 ? 504 : 502).json({
          error: {
            code: err.code,
            message: err.message || 'A Klyra não conseguiu responder agora. Tente novamente.',
          },
        });
      }
      throw err;
    }
  });

  router.delete('/conversations/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'ID de conversa inválido.' },
      });
    }

    await deleteConversation(db, req.user.id, id);
    res.status(204).end();
  });

  // ---- Extração de texto de arquivos (PDF/TXT) para a Klyra ----
  const extractUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  });

  router.post('/extract-text', extractUpload.single('file'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Envie um arquivo.' },
      });
    }
    try {
      const text = await extractFileText(req.file);
      if (!text?.trim()) {
        return res.status(422).json({
          error: {
            code: 'EMPTY_TEXT',
            message: 'Não consegui extrair texto deste arquivo. Tente PDF, TXT ou MD.',
          },
        });
      }
      res.json({ text: text.slice(0, 60000), fileName: req.file.originalname });
    } catch (err) {
      res.status(422).json({
        error: {
          code: 'EXTRACT_FAILED',
          message: err.message || 'Falha ao ler o arquivo.',
        },
      });
    }
  });

  router.post('/extract-material', async (req, res) => {
    const materialId = Number(req.body?.materialId);
    if (!Number.isInteger(materialId) || materialId < 1) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Material inválido.' },
      });
    }
    try {
      const text = await extractMaterialText(db, config, req.user.id, materialId);
      if (!text?.trim()) {
        return res.status(422).json({
          error: {
            code: 'EMPTY_TEXT',
            message: 'Não consegui extrair texto deste material.',
          },
        });
      }
      res.json({ text: text.slice(0, 60000) });
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({
        error: {
          code: err.code || 'EXTRACT_FAILED',
          message: err.message || 'Falha ao ler o material.',
        },
      });
    }
  });

  router.get('/limits', async (_req, res) => {
    res.json({
      maxMessageLength: KLYRA_LIMITS.maxMessageLength,
      dailyMessageLimit: KLYRA_LIMITS.dailyMessageLimit,
    });
  });

  return router;
}
