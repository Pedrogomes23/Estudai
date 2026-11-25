/**
 * Provedor de IA — Groq (modelo qwen/qwen3.8-27b).
 * API compatível com OpenAI. Toda comunicação acontece exclusivamente pelo backend.
 */

const GROQ_API_BASE = 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = 'qwen/qwen3.8-27b';
const FETCH_TIMEOUT_MS = 55000;

/**
 * Envia o histórico de mensagens para o Groq e devolve a resposta do assistente.
 * Interface compatível com a antiga chatWithGemini (para não quebrar imports).
 */
export async function chatWithGemini({
  apiKey,
  model = DEFAULT_MODEL,
  messages,
  systemInstruction,
}) {
  if (!apiKey) {
    throw new Error('GROQ_API_KEY não configurada.');
  }

  const openaiMessages = [];

  if (systemInstruction) {
    openaiMessages.push({
      role: 'system',
      content: systemInstruction,
    });
  }

  for (const m of messages) {
    openaiMessages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    });
  }

  const body = {
    model: model || DEFAULT_MODEL,
    messages: openaiMessages,
    temperature: 0.7,
    top_p: 0.95,
    max_tokens: 2048,
  };

  const url = `${GROQ_API_BASE}/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') {
      const error = new Error('A Klyra demorou demais para responder. Tente de novo.');
      error.code = 'AI_TIMEOUT';
      error.status = 504;
      throw error;
    }
    const error = new Error('Não foi possível conectar à Klyra. Verifique a internet e tente de novo.');
    error.code = 'AI_PROVIDER_ERROR';
    error.status = 502;
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let message = `Erro na API do Groq (${res.status})`;
    try {
      const parsed = JSON.parse(errText);
      message = parsed?.error?.message || message;
    } catch {
      // ignora
    }
    const error = new Error(message);
    error.status = res.status;
    error.code = res.status === 429 ? 'RATE_LIMITED' : 'AI_PROVIDER_ERROR';
    throw error;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || '';

  if (!text) {
    const error = new Error('A Klyra não conseguiu gerar uma resposta. Tente novamente.');
    error.code = 'AI_EMPTY_RESPONSE';
    throw error;
  }

  return { text, model: model || DEFAULT_MODEL };
}

export const GEMINI_DEFAULT_MODEL = DEFAULT_MODEL;
export const GROQ_DEFAULT_MODEL = DEFAULT_MODEL;
