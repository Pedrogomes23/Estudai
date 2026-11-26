import test from 'node:test';
import assert from 'node:assert/strict';
import { chatWithGemini } from '../src/services/ai/provider.js';

test('Groq interpreta Retry-After em segundos', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? '3' : null) },
    text: async () => '{}',
  });
  try {
    await assert.rejects(chatWithGemini({ apiKey: 'test-key', messages: [] }), (error) => {
      assert.equal(error.retryAfterMs, 3000);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Groq interpreta Retry-After como data HTTP', async () => {
  const future = new Date(Date.now() + 5000).toUTCString();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? future : null) },
    text: async () => '{}',
  });
  try {
    await assert.rejects(chatWithGemini({ apiKey: 'test-key', messages: [] }), (error) => {
      assert.ok(error.retryAfterMs >= 0 && error.retryAfterMs <= 5000);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Groq mantÃ©m 429 sem inventar Retry-After quando o cabeÃ§alho nÃ£o existe', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    headers: { get: () => null },
    text: async () => '{}',
  });
  try {
    await assert.rejects(chatWithGemini({ apiKey: 'test-key', messages: [] }), (error) => {
      assert.equal(error.retryAfterMs, undefined);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Regress?es: distinguir respostas HTTP de falhas de transporte.

test('Groq marca respostas HTTP 503', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    headers: { get: () => null },
    text: async () => '{}',
  });

  try {
    await assert.rejects(chatWithGemini({ apiKey: 'test-key', messages: [] }), (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'AI_PROVIDER_ERROR');
      assert.equal(error.providerResponse, true);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Falha de conex?o 502 n?o ? marcada como resposta HTTP', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    throw new Error('Falha simulada de conex?o');
  };

  try {
    await assert.rejects(chatWithGemini({ apiKey: 'test-key', messages: [] }), (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'AI_PROVIDER_ERROR');
      assert.equal(error.providerResponse, undefined);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Timeout 504 n?o ? marcado como resposta HTTP', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    const error = new Error('Timeout simulado');
    error.name = 'AbortError';
    throw error;
  };

  try {
    await assert.rejects(chatWithGemini({ apiKey: 'test-key', messages: [] }), (error) => {
      assert.equal(error.status, 504);
      assert.equal(error.code, 'AI_TIMEOUT');
      assert.equal(error.providerResponse, undefined);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Groq marca HTTP 429 como resposta expl?cita de limite', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    headers: { get: () => null },
    text: async () => '{}',
  });

  try {
    await assert.rejects(chatWithGemini({ apiKey: 'test-key', messages: [] }), (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.code, 'RATE_LIMITED');
      assert.equal(error.providerResponse, true);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
