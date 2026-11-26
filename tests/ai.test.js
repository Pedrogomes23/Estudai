import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startTestServer, signedInClient } from './helpers.js';

test('segurança dos anexos da Klyra', async (t) => {
  const srv = await startTestServer({
    geminiApiKey: 'test-key',
  });

  t.after(async () => {
    await srv.close();
  });

  const owner = (await signedInClient(srv)).client;
  const other = (await signedInClient(srv)).client;

  async function uploadText(client, content = 'Conteudo confidencial do material.') {
    const form = new FormData();
    form.set('file', new Blob([content], { type: 'text/plain' }), 'material.txt');

    return client.post('/api/ai/extract-text', form);
  }

  async function createConversation(client) {
    const response = await client.post('/api/ai/conversations', {});
    assert.equal(response.status, 201);
    return response.data.item.id;
  }

  async function sendAttachment(client, conversationId, token) {
    return client.post(`/api/ai/conversations/${conversationId}/messages`, {
      content: 'Analise este material.',
      attachmentToken: token,
    });
  }

  await t.test('exige autenticação para extrair arquivos', async () => {
    const anonymous = srv.client();
    const response = await anonymous.post('/api/ai/extract-text', {});

    assert.equal(response.status, 401);
  });

  await t.test('gera token seguro e não devolve o conteúdo do arquivo', async () => {
    const response = await uploadText(owner);

    assert.equal(response.status, 200);
    assert.match(response.data.token, /^[a-f0-9]{64}$/);
    assert.equal(response.data.fileName, 'material.txt');
    assert.equal(response.data.content, undefined);
    assert.equal(response.data.text, undefined);

    const hash = createHash('sha256').update(response.data.token).digest('hex');

    const stored = await srv.db.get(
      'SELECT token_hash, name, content FROM ai_pending_documents WHERE token_hash = $1',
      [hash],
    );

    assert.ok(stored);
    assert.equal(stored.token_hash, hash);
    assert.notEqual(stored.token_hash, response.data.token);
    assert.equal(stored.content, 'Conteudo confidencial do material.');
    assert.equal(stored.name, 'material.txt');
  });

  await t.test('impede que outro usuário utilize o token', async () => {
    const uploaded = await uploadText(owner);
    const otherConversation = await createConversation(other);

    const response = await sendAttachment(other, otherConversation, uploaded.data.token);

    assert.equal(response.status, 410);
    assert.equal(response.data.error.code, 'ATTACHMENT_EXPIRED');
  });

  await t.test('rejeita tokens expirados', async () => {
    const uploaded = await uploadText(owner);
    const conversationId = await createConversation(owner);

    const hash = createHash('sha256').update(uploaded.data.token).digest('hex');

    await srv.db.run(
      `UPDATE ai_pending_documents
       SET expires_at = now() - interval '1 minute'
       WHERE token_hash = $1`,
      [hash],
    );

    const response = await sendAttachment(owner, conversationId, uploaded.data.token);

    assert.equal(response.status, 410);
    assert.equal(response.data.error.code, 'ATTACHMENT_EXPIRED');
  });

  await t.test('rejeita tokens em formato inválido', async () => {
    const conversationId = await createConversation(owner);

    const response = await sendAttachment(owner, conversationId, 'token-invalido');

    assert.equal(response.status, 400);
  });

  await t.test('consome o token após resposta bem-sucedida e impede reutilização', async () => {
    const uploaded = await uploadText(owner);
    const conversationId = await createConversation(owner);

    const hash = createHash('sha256').update(uploaded.data.token).digest('hex');

    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url;

      if (String(url).startsWith('https://api.groq.com/')) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'Resposta simulada da Klyra.',
                },
              },
            ],
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      }

      return originalFetch(input, init);
    };

    try {
      const response = await sendAttachment(owner, conversationId, uploaded.data.token);

      assert.equal(response.status, 201);
      assert.equal(response.data.assistantMessage.content, 'Resposta simulada da Klyra.');

      const stored = await srv.db.get('SELECT token_hash FROM ai_pending_documents WHERE token_hash = $1', [
        hash,
      ]);

      assert.equal(stored, undefined);

      const reused = await sendAttachment(owner, conversationId, uploaded.data.token);

      assert.equal(reused.status, 410);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('recuperação de falhas e limite de extrações da Klyra', async (t) => {
  await t.test('libera o token quando a Groq falha e permite nova tentativa', async (t) => {
    const srv = await startTestServer({
      geminiApiKey: 'test-key',
    });

    t.after(async () => {
      await srv.close();
    });

    const client = (await signedInClient(srv)).client;

    const form = new FormData();
    form.set(
      'file',
      new Blob(['Material para teste de recuperacao.'], {
        type: 'text/plain',
      }),
      'recuperacao.txt',
    );

    const uploaded = await client.post('/api/ai/extract-text', form);
    assert.equal(uploaded.status, 200);

    const conversation = await client.post('/api/ai/conversations', {});
    assert.equal(conversation.status, 201);

    const conversationId = conversation.data.item.id;
    const token = uploaded.data.token;
    const requestId = 'b7d2f6a1-7e3c-4a91-8b52-9c4d1e6f2030';

    const hash = createHash('sha256').update(token).digest('hex');

    const originalFetch = globalThis.fetch;
    let simulateFailure = true;

    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url;

      if (String(url).startsWith('https://api.groq.com/')) {
        if (simulateFailure) {
          return new Response(
            JSON.stringify({
              error: { message: 'Falha simulada.' },
            }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'Resposta após nova tentativa.',
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      return originalFetch(input, init);
    };

    try {
      const failed = await client.post(`/api/ai/conversations/${conversationId}/messages`, {
        content: 'Analise o arquivo.',
        attachmentToken: token,
        requestId,
      });

      assert.equal(failed.status, 502);

      const released = await srv.db.get(
        `SELECT claimed_at
         FROM ai_pending_documents
         WHERE token_hash = $1`,
        [hash],
      );

      assert.ok(released);
      assert.equal(released.claimed_at, null);

      simulateFailure = false;

      const retried = await client.post(`/api/ai/conversations/${conversationId}/messages`, {
        content: 'Analise o arquivo.',
        attachmentToken: token,
        requestId,
      });

      assert.equal(retried.status, 201);
      assert.equal(retried.data.assistantMessage.content, 'Resposta após nova tentativa.');

      const consumed = await srv.db.get('SELECT token_hash FROM ai_pending_documents WHERE token_hash = $1', [
        hash,
      ]);

      assert.equal(consumed, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('bloqueia a sétima extração dentro de um minuto', async (t) => {
    const srv = await startTestServer({
      rateLimit: { enabled: true },
    });

    t.after(async () => {
      await srv.close();
    });

    const client = (await signedInClient(srv)).client;

    async function upload() {
      const form = new FormData();
      form.set('file', new Blob(['Texto de teste.'], { type: 'text/plain' }), 'limite.txt');

      return client.post('/api/ai/extract-text', form);
    }

    for (let i = 1; i <= 6; i += 1) {
      const response = await upload();
      assert.equal(response.status, 200, `Extração ${i} deveria ser permitida.`);
    }

    const blocked = await upload();

    assert.equal(blocked.status, 429);
    assert.equal(blocked.data.error.code, 'RATE_LIMITED');
  });
});
