const DEFAULT_MAX_ESTIMATED_TOKENS = 4300;
const MAX_HISTORY_CHARS = 6000;
const MAX_DOCUMENT_CHARS = 10000;
const CHARS_PER_TOKEN = 2.5;

export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / CHARS_PER_TOKEN);
}

function trimHistory(history, maxChars) {
  const result = [];
  let remaining = Math.max(0, Math.floor(maxChars));

  for (let index = history.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const message = history[index];
    const content = String(message.content || '');
    const excerpt = content.slice(-remaining);
    result.unshift({ ...message, content: excerpt });
    remaining -= excerpt.length;
  }

  return result;
}

export function allocateContextBudget({
  systemInstruction = '',
  currentMessage = '',
  history = [],
  maxEstimatedTokens = DEFAULT_MAX_ESTIMATED_TOKENS,
  maxHistoryChars = MAX_HISTORY_CHARS,
  maxDocumentChars = MAX_DOCUMENT_CHARS,
} = {}) {
  const limit = Math.max(1, Math.floor(maxEstimatedTokens));
  const fixedTokens = estimateTokens(systemInstruction) + estimateTokens(currentMessage) + 32;
  const remainingAfterFixed = Math.max(0, limit - fixedTokens);

  // Preserva espaÃ§o para o material anexado e evita que o histÃ³rico consuma todo o orÃ§amento.
  const reservedDocumentTokens = Math.min(600, Math.floor(remainingAfterFixed * 0.6));
  const historyTokens = Math.max(0, remainingAfterFixed - reservedDocumentTokens);
  const historyCharBudget = Math.min(maxHistoryChars, Math.floor(historyTokens * CHARS_PER_TOKEN));
  const boundedHistory = trimHistory(history, historyCharBudget);
  const usedHistoryTokens = boundedHistory.reduce((sum, item) => sum + estimateTokens(item.content) + 8, 0);
  const documentTokens = Math.max(0, remainingAfterFixed - usedHistoryTokens);
  const documentCharBudget = Math.min(maxDocumentChars, Math.floor(documentTokens * CHARS_PER_TOKEN));

  return {
    history: boundedHistory,
    documentMaxChars: documentCharBudget,
    estimatedInputTokens: fixedTokens + usedHistoryTokens + estimateTokens('x'.repeat(documentCharBudget)),
    maxEstimatedTokens: limit,
  };
}
