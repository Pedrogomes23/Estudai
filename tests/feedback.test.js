import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signedInClient, startTestServer } from './helpers.js';

const valid = {
  rating: 5,
  category: 'Sugestão',
  area: 'Apostilas',
  message: 'Seria legal poder favoritar as apostilas.',
  allowContact: true,
};

describe('feedback', () => {
  let srv, a, b;
  before(async () => {
    srv = await startTestServer();
    a = (await signedInClient(srv)).client;
    b = (await signedInClient(srv)).client;
  });
  after(() => srv.close());

  it('exige login para enviar e para listar', async () => {
    const anon = srv.client();
    assert.equal((await anon.post('/api/feedback', valid)).status, 401);
    assert.equal((await anon.get('/api/feedback/mine')).status, 401);
  });

  it('envia um feedback válido e devolve o item', async () => {
    const res = await a.post('/api/feedback', valid);
    assert.equal(res.status, 201);
    assert.equal(res.data.item.rating, 5);
    assert.equal(res.data.item.category, 'Sugestão');
    assert.equal(res.data.item.area, 'Apostilas');
    assert.equal(res.data.item.message, valid.message);
    assert.equal(res.data.item.allowContact, true);
    assert.match(res.data.item.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('allowContact é opcional e vale false por padrão', async () => {
    const { allowContact: _omit, ...rest } = valid;
    const res = await a.post('/api/feedback', rest);
    assert.equal(res.status, 201);
    assert.equal(res.data.item.allowContact, false);
  });

  it('apara espaços da mensagem', async () => {
    const res = await a.post('/api/feedback', { ...valid, message: '   texto com espaços ao redor   ' });
    assert.equal(res.data.item.message, 'texto com espaços ao redor');
  });

  it('rejeita dados inválidos com 400 e a mensagem do campo', async () => {
    const cases = [
      [{ ...valid, rating: 0 }, 'rating'],
      [{ ...valid, rating: 6 }, 'rating'],
      [{ ...valid, rating: 3.5 }, 'rating'],
      [{ ...valid, rating: '5' }, 'rating'],
      [{ ...valid, rating: undefined }, 'rating'],
      [{ ...valid, category: 'Reclamação' }, 'category'],
      [{ ...valid, area: 'Financeiro' }, 'area'],
      [{ ...valid, message: 'curto' }, 'message'],
      [{ ...valid, message: '         ' }, 'message'],
      [{ ...valid, message: 'x'.repeat(1001) }, 'message'],
    ];
    for (const [body, field] of cases) {
      const res = await a.post('/api/feedback', body);
      assert.equal(res.status, 400, `esperava 400 para ${field}: ${JSON.stringify(body).slice(0, 80)}`);
      assert.equal(res.data.error.code, 'VALIDATION_ERROR');
      assert.ok(res.data.error.fields[field], `sem mensagem para o campo ${field}`);
    }
  });

  it('lista só os feedbacks do próprio usuário, do mais novo para o mais antigo', async () => {
    await b.post('/api/feedback', { ...valid, message: 'Feedback do segundo usuário.' });
    const mineA = (await a.get('/api/feedback/mine')).data.items;
    const mineB = (await b.get('/api/feedback/mine')).data.items;
    assert.equal(mineB.length, 1);
    assert.equal(mineB[0].message, 'Feedback do segundo usuário.');
    assert.equal(mineA.length, 3);
    assert.equal(mineA[0].message, 'texto com espaços ao redor');
    assert.ok(mineA.every((i) => i.message !== 'Feedback do segundo usuário.'));
  });

  it('guarda texto malicioso como texto puro (escape é feito na tela)', async () => {
    const body = { ...valid, message: '<script>alert(1)</script> teste' };
    const res = await a.post('/api/feedback', body);
    assert.equal(res.status, 201);
    assert.equal(res.data.item.message, body.message);
  });

  it('limita o envio por usuário quando o rate limit está ligado', async () => {
    const limited = await startTestServer({ rateLimit: { enabled: true, authMax: 20, windowMs: 900000 } });
    try {
      const { client } = await signedInClient(limited);
      for (let i = 0; i < 5; i++) assert.equal((await client.post('/api/feedback', valid)).status, 201);
      const blocked = await client.post('/api/feedback', valid);
      assert.equal(blocked.status, 429);
      assert.equal(blocked.data.error.code, 'RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });

  it('serve a página estática', async () => {
    const res = await fetch(`${srv.base}/feedback`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Deixe seu feedback/);
  });
});
