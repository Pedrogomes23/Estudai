import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

describe('autenticação', () => {
  let srv;
  before(async () => (srv = await startTestServer()));
  after(() => srv.close());

  const user = { name: 'Ana Souza', email: 'ana@exemplo.com', password: 'senha-segura-123' };

  it('cria conta e não devolve a senha', async () => {
    const res = await srv.client().post('/api/auth/register', user);
    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(res.data.user).sort(), ['email', 'id', 'name']);
  });

  it('guarda apenas o hash scrypt da senha', async () => {
    const row = await srv.db.get('SELECT password_hash FROM users WHERE email = $1', [user.email]);
    assert.match(row.password_hash, /^scrypt\$/);
    assert.ok(!row.password_hash.includes(user.password));
  });

  it('rejeita e-mail repetido (sem diferenciar maiúsculas)', async () => {
    const res = await srv.client().post('/api/auth/register', { ...user, email: 'ANA@exemplo.com' });
    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, 'EMAIL_TAKEN');
  });

  it('valida nome, e-mail e senha com mínimo de 8 caracteres', async () => {
    const c = srv.client();
    assert.equal((await c.post('/api/auth/register', { ...user, password: '1234567' })).status, 400);
    assert.equal((await c.post('/api/auth/register', { ...user, email: 'sem-arroba' })).status, 400);
    assert.equal((await c.post('/api/auth/register', { ...user, name: '   ' })).status, 400);
  });

  it('distingue e-mail inexistente de senha incorreta', async () => {
    const c = srv.client();
    const a = await c.post('/api/auth/login', { email: 'ninguem@exemplo.com', password: 'qualquer-coisa' });
    assert.equal(a.status, 401);
    assert.equal(a.data.error.code, 'EMAIL_NOT_FOUND');
    const b = await c.post('/api/auth/login', { email: user.email, password: 'errada-errada' });
    assert.equal(b.status, 401);
    assert.equal(b.data.error.code, 'WRONG_PASSWORD');
  });

  it('login cria cookie HttpOnly e /me identifica o usuário', async () => {
    const c = srv.client();
    const login = await c.post('/api/auth/login', { email: user.email, password: user.password });
    assert.equal(login.status, 200);
    const cookie = login.setCookie[0];
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.doesNotMatch(cookie, /Max-Age/i, 'sem "manter conectado" o cookie é de sessão');
    assert.equal((await c.get('/api/auth/me')).data.user.email, user.email);
  });

  it('"manter conectado" gera cookie persistente', async () => {
    const res = await srv.client().post('/api/auth/login', { ...user, remember: true });
    assert.match(res.setCookie[0], /Max-Age=/i);
  });

  it('logout invalida a sessão no servidor', async () => {
    const c = srv.client();
    await c.post('/api/auth/login', { email: user.email, password: user.password });
    const token = (await c.post('/api/auth/logout')).status;
    assert.equal(token, 204);
    assert.equal((await c.get('/api/auth/me')).status, 401);
  });

  it('/me sem login retorna 401', async () => {
    assert.equal((await srv.client().get('/api/auth/me')).status, 401);
  });

  it('bloqueia requisições que alteram dados vindas de outra origem', async () => {
    const res = await srv
      .client()
      .post(
        '/api/auth/login',
        { email: user.email, password: user.password },
        { Origin: 'https://site-malicioso.com' },
      );
    assert.equal(res.status, 403);
    assert.equal(res.data.error.code, 'BAD_ORIGIN');
  });
});

describe('limite de tentativas', () => {
  it('responde 429 depois de muitas tentativas de login', async () => {
    const srv = await startTestServer({ rateLimit: { enabled: true, authMax: 3, windowMs: 60_000 } });
    try {
      const c = srv.client();
      const codes = [];
      for (let i = 0; i < 5; i++) {
        codes.push((await c.post('/api/auth/login', { email: 'x@y.com', password: 'abcdefgh' })).status);
      }
      assert.deepEqual(codes, [401, 401, 401, 429, 429]);
    } finally {
      await srv.close();
    }
  });
});
