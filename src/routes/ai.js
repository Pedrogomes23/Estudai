import { Router } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  beginMessageRequest,
  completeMessageRequest,
  markMessageRequestRetryable,
  markMessageRequestUncertain,
} from '../services/ai/message-idempotency.js';

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

const PENDING_DOCUMENT_TTL_MINUTES = 15;

const hashDocumentToken = (token) => createHash('sha256').update(token).digest('hex');

async function storePendingDocument(db, userId, name, content) {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashDocumentToken(token);

  await db.run('DELETE FROM ai_pending_documents WHERE user_id = $1 AND expires_at <= now()', [userId]);

  await db.run(
    `INSERT INTO ai_pending_documents
      (token_hash, user_id, name, content, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '${PENDING_DOCUMENT_TTL_MINUTES} minutes')`,
    [tokenHash, userId, String(name || 'documento').slice(0, 200), String(content).slice(0, 60000)],
  );

  return token;
}

async function claimPendingDocument(db, userId, token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;

  return db.get(
    `UPDATE ai_pending_documents
       SET claimed_at = now()
     WHERE token_hash = $1
       AND user_id = $2
       AND expires_at > now()
       AND (claimed_at IS NULL OR claimed_at < now() - interval '4 minutes')
     RETURNING name, content`,
    [hashDocumentToken(token), userId],
  );
}

async function releasePendingDocument(db, userId, token) {
  await db.run('UPDATE ai_pending_documents SET claimed_at = NULL WHERE token_hash = $1 AND user_id = $2', [
    hashDocumentToken(token),
    userId,
  ]);
}

async function consumePendingDocument(db, userId, token) {
  await db.run('DELETE FROM ai_pending_documents WHERE token_hash = $1 AND user_id = $2', [
    hashDocumentToken(token),
    userId,
  ]);
}

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
  attachmentToken: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  requestId: z.string().uuid().optional(),
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
    const messages = await listMessages(db, req.user.id, id, true);

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

    const { content, attachmentToken, requestId: suppliedRequestId } = parse(sendSchema, req.body);

    const requestId = suppliedRequestId || randomUUID();
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify({
          content,
          attachmentToken: attachmentToken || null,
        }),
      )
      .digest('hex');

    let requestStarted = false;
    let claimedDocument = null;

    try {
      const requestState = await beginMessageRequest(db, {
        userId: req.user.id,
        requestId,
        conversationId: id,
        payloadHash,
      });

      requestStarted = true;

      if (requestState.action === 'conflict') {
        return res.status(409).json({
          error: {
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'Este identificador já foi utilizado com outra mensagem ou conversa.',
          },
        });
      }

      if (requestState.action === 'completed') {
        return res.status(201).json(requestState.response);
      }

      if (requestState.action === 'processing') {
        return res.status(202).json({
          status: 'processing',
          requestId,
        });
      }

      if (requestState.action === 'uncertain') {
        return res.status(409).json({
          error: {
            code: 'REQUEST_RESULT_UNCERTAIN',
            message:
              'Não foi possível confirmar o resultado anterior. Atualize a conversa antes de enviar uma nova mensagem.',
          },
        });
      }

      if (attachmentToken) {
        claimedDocument = await claimPendingDocument(db, req.user.id, attachmentToken);

        if (!claimedDocument) {
          await markMessageRequestRetryable(db, {
            userId: req.user.id,
            requestId,
            errorCode: 'ATTACHMENT_UNAVAILABLE',
          });

          return res.status(410).json({
            error: {
              code: 'ATTACHMENT_EXPIRED',
              message: 'O anexo expirou ou não está mais disponível. Envie o arquivo novamente.',
            },
          });
        }
      }

      const result = await sendMessage(db, {
        userId: req.user.id,
        conversationId: id,
        content,
        attachmentName: claimedDocument?.name,
        attachmentText: claimedDocument?.content,
        apiKey: config.geminiApiKey,
        model: config.geminiModel || GEMINI_DEFAULT_MODEL,
        requestId,
        existingUserMessageId: requestState.action === 'retry' ? requestState.userMessageId : undefined,
      });

      const response = {
        userMessage: toMessageApi(result.userMessage),
        assistantMessage: toMessageApi(result.assistantMessage),
        remainingToday: result.remainingToday,
        title: result.title || undefined,
      };

      await completeMessageRequest(db, {
        userId: req.user.id,
        requestId,
        response,
      });

      if (attachmentToken) {
        await consumePendingDocument(db, req.user.id, attachmentToken).catch(() => {});
      }

      return res.status(201).json(response);
    } catch (err) {
      const safeToRetry =
        err.code === 'AI_QUOTA_UNAVAILABLE' ||
        (err.providerResponse === true &&
          Number.isInteger(err.status) &&
          err.status >= 400 &&
          err.status < 600 &&
          err.status !== 429) ||
        err.status === 400 ||
        err.status === 403 ||
        err.status === 404;

      if (attachmentToken && claimedDocument) {
        const settleAttachment = safeToRetry ? releasePendingDocument : consumePendingDocument;
        await settleAttachment(db, req.user.id, attachmentToken).catch(() => {});
      }

      if (requestStarted) {
        const safeToRetry =
          err.code === 'AI_QUOTA_UNAVAILABLE' ||
          (err.providerResponse === true &&
            Number.isInteger(err.status) &&
            err.status >= 400 &&
            err.status < 600 &&
            err.status !== 429) ||
          err.status === 400 ||
          err.status === 403 ||
          err.status === 404;

        const updateRequest = safeToRetry ? markMessageRequestRetryable : markMessageRequestUncertain;

        await updateRequest(db, {
          userId: req.user.id,
          requestId,
          errorCode: err.code || 'REQUEST_FAILED',
        }).catch(() => {});
      }

      if (err.code === 'RATE_LIMITED' || err.status === 429) {
        const retryAfterSeconds = Number.isFinite(err.retryAfterMs)
          ? Math.ceil(err.retryAfterMs / 1000)
          : null;

        if (retryAfterSeconds !== null) {
          res.set('Retry-After', String(retryAfterSeconds));
        }

        return res.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message:
              'A Klyra atingiu temporariamente o limite de solicitações da IA. Aguarde um pouco e tente novamente.',
            retryAfterSeconds,
          },
        });
      }

      if (err.code === 'AI_QUOTA_UNAVAILABLE') {
        return res.status(503).json({
          error: {
            code: 'AI_QUOTA_UNAVAILABLE',
            message: 'A Klyra está temporariamente indisponível. Tente novamente em instantes.',
          },
        });
      }

      if (err.code === 'AI_PROVIDER_ERROR' || err.code === 'AI_EMPTY_RESPONSE' || err.code === 'AI_TIMEOUT') {
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
  const extractLimiter = config.rateLimit.enabled
    ? rateLimit({
        windowMs: 60 * 1000,
        limit: 6,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        keyGenerator: (req) => `klyra-extract-user-${req.user.id}`,
        message: {
          error: {
            code: 'RATE_LIMITED',
            message: 'Você realizou muitas extrações. Aguarde um minuto e tente novamente.',
          },
        },
      })
    : (_req, _res, next) => next();

  const extractUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  });

  router.post('/extract-text', extractLimiter, extractUpload.single('file'), async (req, res) => {
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
      const token = await storePendingDocument(db, req.user.id, req.file.originalname, text);
      res.json({ token, fileName: req.file.originalname });
    } catch (err) {
      res.status(422).json({
        error: {
          code: 'EXTRACT_FAILED',
          message: err.message || 'Falha ao ler o arquivo.',
        },
      });
    }
  });

  router.post('/extract-material', extractLimiter, async (req, res) => {
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
      const token = await storePendingDocument(db, req.user.id, `Material ${materialId}`, text);
      res.json({ token, fileName: `Material ${materialId}` });
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
