/**
 * Lógica da Klyra IA — tutora de estudos do Estudaí.
 */

import { chatWithGemini, GEMINI_DEFAULT_MODEL } from './provider.js';
import { selectRelevantDocumentContext } from './document-context.js';
import { allocateContextBudget } from './context-budget.js';
import { reserveGroqCapacity, settleGroqReservation, markGroqReservationUncertain } from './groq-limits.js';
import { recordMessageRequestUserMessage } from './message-idempotency.js';
import { notFound, forbidden, badRequest } from '../../lib/errors.js';

const SYSTEM_INSTRUCTION = `Você é a Klyra, a tutora de inteligência artificial do Estudaí.
Seu objetivo é ajudar estudantes brasileiros de forma clara, paciente e motivadora.

Regras:
- Responda sempre em português do Brasil.
- Explique conteúdos de forma didática, com exemplos quando possível.
- Ajude na resolução de exercícios passo a passo, sem entregar a resposta pronta de imediato (incentive o raciocínio).
- Seja amigável, encorajadora e objetiva.
- Se não souber algo com certeza, diga isso e oriente o estudante a buscar fontes confiáveis.
- Não invente informações factuais.
- Não discuta temas fora do contexto de estudos e educação, a menos que o estudante peça ajuda relacionada.
- Quando o estudante anexar um material/arquivo, use o conteúdo para resumir, explicar, criar flashcards, atividades ou corrigir conforme pedido.
- Respostas com listas, negrito e estrutura clara (markdown) são bem-vindas.`;

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_CHARS = 6000;
const DAILY_MESSAGE_LIMIT = 40;

async function countTodayMessages(db, userId) {
  const { n } = await db.get(
    `SELECT COUNT(*)::int AS n
       FROM ai_messages m
       JOIN ai_conversations c ON c.id = m.conversation_id
      WHERE c.user_id = $1
        AND m.role = 'user'
        AND m.created_at >= date_trunc('day', now())`,
    [userId],
  );
  return n;
}

export async function listConversations(db, userId) {
  return db.all(
    `SELECT id, title, created_at, updated_at
       FROM ai_conversations
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT 50`,
    [userId],
  );
}

export async function createConversation(db, userId, title = 'Nova conversa') {
  return db.get(
    `INSERT INTO ai_conversations (user_id, title)
     VALUES ($1, $2)
     RETURNING id, title, created_at, updated_at`,
    [userId, title.slice(0, 120)],
  );
}

export async function getConversation(db, userId, conversationId) {
  const row = await db.get(
    `SELECT id, user_id, title, created_at, updated_at
       FROM ai_conversations
      WHERE id = $1 AND user_id = $2`,
    [conversationId, userId],
  );
  if (!row) throw notFound('Conversa não encontrada.');
  return row;
}

export async function listMessages(db, userId, conversationId, conversationAlreadyVerified = false) {
  if (!conversationAlreadyVerified) {
    await getConversation(db, userId, conversationId);
  }
  return db.all(
    `SELECT id, role, content, created_at
       FROM ai_messages
      WHERE conversation_id = $1
      ORDER BY id ASC`,
    [conversationId],
  );
}

export async function sendMessage(
  db,
  {
    userId,
    conversationId,
    content,
    apiKey,
    model,
    attachmentName,
    attachmentText,
    requestId,
    existingUserMessageId,
  },
) {
  const trimmed = (content || '').trim();
  const hasAttachment = Boolean(attachmentText && String(attachmentText).trim());
  if (!trimmed && !hasAttachment) throw badRequest('Escreva uma mensagem ou anexe um arquivo.');
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw badRequest(`A mensagem deve ter no máximo ${MAX_MESSAGE_LENGTH} caracteres.`);
  }

  const usedToday = await countTodayMessages(db, userId);
  if (!existingUserMessageId && usedToday >= DAILY_MESSAGE_LIMIT) {
    throw forbidden(`Você atingiu o limite diário de ${DAILY_MESSAGE_LIMIT} mensagens. Volte amanhã!`);
  }

  const conversation = await getConversation(db, userId, conversationId);

  // Persiste o documento para consultas futuras na mesma conversa.
  let activeDocument = null;

  if (hasAttachment) {
    activeDocument = await db.get(
      `INSERT INTO ai_documents (conversation_id, name, content)
       VALUES ($1, $2, $3)
       ON CONFLICT (conversation_id)
       DO UPDATE SET
         name = EXCLUDED.name,
         content = EXCLUDED.content,
         updated_at = now()
       RETURNING name, content`,
      [
        conversationId,
        String(attachmentName || 'documento').slice(0, 120),
        String(attachmentText).slice(0, 60000),
      ],
    );
  } else {
    activeDocument = await db.get('SELECT name, content FROM ai_documents WHERE conversation_id = $1', [
      conversationId,
    ]);
  }

  const history = await db.all(
    `SELECT role, content
       FROM ai_messages
      WHERE conversation_id = $1
        AND id <= (
          SELECT COALESCE(MAX(id), 0)
            FROM ai_messages
           WHERE conversation_id = $1 AND role = 'assistant'
        )
      ORDER BY id DESC
      LIMIT $2`,
    [conversationId, MAX_HISTORY_MESSAGES],
  );
  history.reverse();

  // Limita o histórico total enviado à IA.
  let remainingHistoryChars = MAX_HISTORY_CHARS;
  const boundedHistory = [];

  for (let i = history.length - 1; i >= 0 && remainingHistoryChars > 0; i--) {
    const messageContent = String(history[i].content || '');
    const content = messageContent.slice(-remainingHistoryChars);

    boundedHistory.push({ ...history[i], content });
    remainingHistoryChars -= content.length;
  }

  history.splice(0, history.length, ...boundedHistory.reverse());

  const storedUserContent = hasAttachment
    ? `${trimmed || 'Analise o arquivo anexado.'}\n\n[Arquivo: ${String(attachmentName || 'documento').slice(0, 120)}]`
    : trimmed;

  let userMsg;

  if (existingUserMessageId) {
    userMsg = await db.get(
      `SELECT id, role, content, created_at
         FROM ai_messages
        WHERE id = $1
          AND conversation_id = $2
          AND role = 'user'`,
      [existingUserMessageId, conversationId],
    );

    if (!userMsg) {
      throw badRequest('Não foi possível recuperar a mensagem original desta solicitação.');
    }
  } else if (requestId) {
    userMsg = await db.transaction(async (tx) => {
      const inserted = await tx.get(
        `INSERT INTO ai_messages (conversation_id, role, content)
         VALUES ($1, 'user', $2)
         RETURNING id, role, content, created_at`,
        [conversationId, storedUserContent],
      );

      await recordMessageRequestUserMessage(tx, {
        userId,
        requestId,
        messageId: inserted.id,
      });

      return inserted;
    });
  } else {
    userMsg = await db.get(
      `INSERT INTO ai_messages (conversation_id, role, content)
       VALUES ($1, 'user', $2)
       RETURNING id, role, content, created_at`,
      [conversationId, storedUserContent],
    );
  }

  // Título automático na primeira mensagem (antes da IA, para não ficar "Nova conversa")
  let titleUpdated = null;
  if (conversation.title === 'Nova conversa' && history.length === 0) {
    titleUpdated = makeTitleFromMessage(trimmed || attachmentName || 'Arquivo anexado');
    await db.run(`UPDATE ai_conversations SET title = $1, updated_at = now() WHERE id = $2`, [
      titleUpdated,
      conversationId,
    ]);
  } else {
    await db.run(`UPDATE ai_conversations SET updated_at = now() WHERE id = $1`, [conversationId]);
  }

  let userContentForAi = trimmed || 'Analise o arquivo anexado e ajude conforme o pedido.';

  const contextBudget = allocateContextBudget({
    systemInstruction: SYSTEM_INSTRUCTION,
    currentMessage: userContentForAi,
    history,
    maxEstimatedTokens: 4300,
  });
  history.splice(0, history.length, ...contextBudget.history);

  if (activeDocument?.content && contextBudget.documentMaxChars > 0) {
    const question = trimmed || 'Analise o arquivo anexado e ajude conforme o pedido.';

    const relevantContext = selectRelevantDocumentContext(activeDocument.content, question, {
      maxChars: contextBudget.documentMaxChars,
    });

    if (relevantContext) {
      userContentForAi +=
        `\n\nMaterial de referência: "${activeDocument.name}".\n` +
        'Use os trechos selecionados abaixo como fonte para responder à pergunta. ' +
        'Se a informação solicitada não estiver nesses trechos, deixe isso claro.\n\n' +
        relevantContext;
    }
  }

  const messagesForAi = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userContentForAi },
  ];

  let aiText;
  const selectedModel = model || GEMINI_DEFAULT_MODEL;
  const reservation = await reserveGroqCapacity(db, {
    model: selectedModel,
    estimatedInputTokens: contextBudget.estimatedInputTokens,
    preferredOutputTokens: 2048,
  });

  let result;
  try {
    result = await chatWithGemini({
      apiKey,
      model: selectedModel,
      messages: messagesForAi,
      systemInstruction: SYSTEM_INSTRUCTION,
      maxOutputTokens: reservation.maxOutputTokens,
    });

    await settleGroqReservation(db, reservation.reservationId, result.usage).catch(() => {});
  } catch (error) {
    const explicitProviderRejection =
      error.providerResponse === true &&
      Number.isInteger(error.status) &&
      error.status >= 400 &&
      error.status < 600 &&
      error.status !== 429;

    if (explicitProviderRejection) {
      // A resposta HTTP explícita não gerou uma resposta da IA.
      // Preserva a contagem de requisições, liberando os tokens reservados.
      await settleGroqReservation(db, reservation.reservationId, { totalTokens: 0 }).catch(() => {});
    } else {
      // Timeout, conexão interrompida e 429 permanecem conservadores.
      await markGroqReservationUncertain(db, reservation.reservationId, {
        retryAfterMs: error.status === 429 ? (error.retryAfterMs ?? 1000) : undefined,
      }).catch(() => {});
    }

    throw error;
  }

  aiText = result.text;

  const assistantMsg = await db.get(
    `INSERT INTO ai_messages (conversation_id, role, content)
     VALUES ($1, 'assistant', $2)
     RETURNING id, role, content, created_at`,
    [conversationId, aiText],
  );

  return {
    userMessage: userMsg,
    assistantMessage: assistantMsg,
    remainingToday: Math.max(0, DAILY_MESSAGE_LIMIT - usedToday - (existingUserMessageId ? 0 : 1)),
    title: titleUpdated || conversation.title,
  };
}

/** Gera título curto a partir da primeira mensagem (estilo ChatGPT). */
function makeTitleFromMessage(text) {
  const oneLine = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!oneLine) return 'Nova conversa';
  if (oneLine.length <= 42) return oneLine;
  const cut = oneLine.slice(0, 42);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > 20 ? cut.slice(0, lastSpace) : cut;
  return `${base}…`;
}

export async function deleteConversation(db, userId, conversationId) {
  const result = await db.run(`DELETE FROM ai_conversations WHERE id = $1 AND user_id = $2`, [
    conversationId,
    userId,
  ]);
  if (result === 0) throw notFound('Conversa não encontrada.');
}

export const KLYRA_LIMITS = {
  maxMessageLength: MAX_MESSAGE_LENGTH,
  dailyMessageLimit: DAILY_MESSAGE_LIMIT,
};
