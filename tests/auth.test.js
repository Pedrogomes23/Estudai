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

  it('exige confirmacao de email antes de permitir login', async () => {
    const rowBefore = await srv.db.get('SELECT email_verified_at FROM users WHERE email = $1', [user.email]);
    assert.equal(rowBefore.email_verified_at, null);

    const blockedLogin = await srv.client().post('/api/auth/login', {
      email: user.email,
      password: user.password,
    });

    assert.equal(blockedLogin.status, 403);
    assert.equal(blockedLogin.data.error.code, 'EMAIL_NOT_VERIFIED');

    const verificationEmail = srv.sentEmails.find(
      (message) => message.type === 'verification' && message.to === user.email,
    );

    assert.ok(verificationEmail, 'email de confirmacao deve ser enviado');

    const token = new URL(verificationEmail.verificationUrl).searchParams.get('token');

    assert.ok(token, 'o link deve conter o token');

    const validation = await srv
      .client()
      .get(`/api/auth/verify-email/validate?token=${encodeURIComponent(token)}`);

    assert.equal(validation.status, 200);
    assert.deepEqual(validation.data, { valid: true });

    const confirmation = await srv.client().post('/api/auth/verify-email', { token });

    assert.equal(confirmation.status, 200);

    const rowAfter = await srv.db.get('SELECT email_verified_at FROM users WHERE email = $1', [user.email]);

    assert.ok(rowAfter.email_verified_at);

    const validationAfter = await srv
      .client()
      .get(`/api/auth/verify-email/validate?token=${encodeURIComponent(token)}`);

    assert.equal(validationAfter.status, 200);
    assert.deepEqual(validationAfter.data, {
      valid: false,
      reason: 'USED',
    });
  });
  it('cria a notificação de boas-vindas ao confirmar o e-mail (uma única vez)', async () => {
    const row = await srv.db.get(
      `SELECT COUNT(*)::int AS n FROM notifications n
         JOIN users u ON u.id = n.user_id
        WHERE u.email = $1 AND n.type = 'welcome'`,
      [user.email],
    );
    assert.equal(row.n, 1);

    const client = srv.client();
    const login = await client.post('/api/auth/login', { email: user.email, password: user.password });
    assert.equal(login.status, 200);

    const list = await client.get('/api/notifications');
    assert.equal(list.status, 200);
    assert.equal(list.data.items[0].type, 'welcome');
    assert.equal(list.data.unread, 1);

    const summary = await client.get('/api/notifications/summary');
    assert.equal(summary.status, 200);
    assert.equal(summary.data.unread, 1);
    assert.equal(summary.data.latestId, list.data.items[0].id);
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

  it('não revela se o e-mail existe durante o login', async () => {
    const c = srv.client();
    const a = await c.post('/api/auth/login', { email: 'ninguem@exemplo.com', password: 'qualquer-coisa' });
    const b = await c.post('/api/auth/login', { email: user.email, password: 'errada-errada' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.data.error.code, 'INVALID_CREDENTIALS');
    assert.equal(b.data.error.code, 'INVALID_CREDENTIALS');
    assert.equal(a.data.error.message, b.data.error.message);
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

describe('segurança da recuperação de senha', () => {
  let srv;

  before(async () => {
    srv = await startTestServer();
  });

  after(async () => {
    await srv.close();
  });

  it('permite consumir um token somente uma vez em requisições simultâneas', async () => {
    const credentials = {
      name: 'Usuário Recuperação',
      email: 'recuperacao@exemplo.com',
      password: 'senha-original-123',
    };

    const registration = await srv.client().post('/api/auth/register', credentials);
    assert.equal(registration.status, 201);

    const { createHash, randomBytes } = await import('node:crypto');
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    await srv.db.run(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [registration.data.user.id, tokenHash, Date.now() + 60_000],
    );

    const passwords = ['senha-nova-111', 'senha-nova-222'];
    const results = await Promise.all(
      passwords.map((password) => srv.client().post('/api/auth/reset-password', { token, password })),
    );

    assert.deepEqual(
      results.map((result) => result.status).sort((a, b) => a - b),
      [200, 400],
    );

    const successfulIndex = results.findIndex((result) => result.status === 200);
    assert.notEqual(successfulIndex, -1);

    const { verifyPassword } = await import('../src/lib/passwords.js');
    const savedUser = await srv.db.get('SELECT password_hash FROM users WHERE id = $1', [
      registration.data.user.id,
    ]);

    assert.equal(await verifyPassword(passwords[successfulIndex], savedUser.password_hash), true);

    const savedToken = await srv.db.get('SELECT used_at FROM password_reset_tokens WHERE token_hash = $1', [
      tokenHash,
    ]);
    assert.ok(savedToken.used_at);
  });

  it('não revela se existe conta quando o SMTP não está configurado', async () => {
    const existing = await srv.client().post('/api/auth/forgot-password', {
      email: 'recuperacao@exemplo.com',
    });
    const missing = await srv.client().post('/api/auth/forgot-password', {
      email: 'nao-existe@exemplo.com',
    });

    assert.equal(existing.status, 200);
    assert.equal(missing.status, 200);
    assert.deepEqual(existing.data, missing.data);
  });
});
