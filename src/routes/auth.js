import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { COOKIE_NAME } from '../lib/sessions.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../lib/passwords.js';
import { conflict, unauthorized, badRequest, HttpError } from '../lib/errors.js';
import { parse, schemas } from '../lib/validation.js';
import { requireAuth } from '../middleware/auth.js';
import { isConstraintError } from '../db/index.js';
import { createMailer } from '../lib/mail.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const publicUser = ({ id, name, email, bio, is_admin, created_at }) => ({
  id,
  name,
  email,
  isAdmin: Boolean(is_admin),
  bio: bio ?? '',
  createdAt: created_at
    ? new Date(created_at).toISOString().replace(/\.\d{3}Z$/, 'Z')
    : null,
});

export function authRouter({ db, config, sessions }) {
  const router = Router();

  const limiter = config.rateLimit.enabled
    ? rateLimit({
        windowMs: config.rateLimit.windowMs,
        limit: config.rateLimit.authMax,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: {
          error: {
            code: 'RATE_LIMITED',
            message: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
          },
        },
      })
    : (_req, _res, next) => next();

  // A coluna `email` é CITEXT: a comparação já ignora maiúsculas/minúsculas.
  const findByEmail = (email) => db.get('SELECT * FROM users WHERE email = $1', [email]);

  const cookieOptions = (remember) => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    ...(remember && { maxAge: config.sessionDays * 86_400_000 }),
  });

  router.post('/register', limiter, async (req, res) => {
    const { name, email, password } = parse(schemas.register, req.body);
    const emailTaken = () =>
      conflict('EMAIL_TAKEN', 'Já existe uma conta com esse e-mail. Use a aba Entrar.');
    if (await findByEmail(email)) throw emailTaken();

    const hash = await hashPassword(password);
    let created;
    try {
      created = await db.get(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [name, email, hash],
      );
    } catch (err) {
      if (isConstraintError(err)) throw emailTaken();
      throw err;
    }
    res.status(201).json({ user: publicUser({ id: created.id, name, email }) });
  });

  router.post('/login', limiter, async (req, res) => {
    const { email, password, remember } = parse(schemas.login, req.body);
    const user = await findByEmail(email);

    if (!user) {
      await verifyPassword(password, DUMMY_HASH); // iguala o tempo de resposta
      throw unauthorized(
        'EMAIL_NOT_FOUND',
        'Não encontramos uma conta com esse e-mail. Crie uma conta para entrar.',
      );
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      throw unauthorized('WRONG_PASSWORD', 'Senha incorreta. Tente de novo.');
    }

    await sessions.destroy(req.sessionToken); // evita reaproveitar uma sessão anterior
    const { token } = await sessions.create(user.id, remember);
    res.cookie(COOKIE_NAME, token, cookieOptions(remember));
    res.json({ user: publicUser(user) });
  });

  router.post('/logout', async (req, res) => {
    await sessions.destroy(req.sessionToken);
    res.clearCookie(COOKIE_NAME, cookieOptions(false));
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  // ---- Recuperação de senha ----
  const mailer = createMailer(config);

  const forgotLimiter = config.rateLimit.enabled
    ? rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 5,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: {
          error: {
            code: 'RATE_LIMITED',
            message: 'Muitas solicitações. Aguarde alguns minutos e tente de novo.',
          },
        },
      })
    : (_req, _res, next) => next();

  /**
   * Solicita recuperação. Sempre responde o mesmo, exista ou não a conta
   * (não revela se o e-mail está cadastrado).
   */
  router.post('/forgot-password', forgotLimiter, async (req, res) => {
    const { email } = parse(schemas.forgotPassword, req.body);
    const generic = {
      message:
        'Se existir uma conta com esse e-mail, enviaremos as instruções para redefinir a senha. Confira a caixa de entrada e o spam.',
    };

    const user = await findByEmail(email);
    if (!user) {
      // Tempo parecido com o caminho que gera token e envia e-mail
      await verifyPassword('x', DUMMY_HASH);
      return res.json(generic);
    }

    if (!mailer.enabled) {
      throw new HttpError(
        503,
        'MAIL_NOT_CONFIGURED',
        'O envio de e-mail ainda não está configurado no servidor. Peça ao administrador para definir SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS e MAIL_FROM.',
      );
    }

    // Invalida tokens anteriores ainda não usados deste usuário
    await db.run(
      `DELETE FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL`,
      [user.id],
    );

    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + config.passwordResetTtlMs;
    await db.run(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, sha256(token), expiresAt],
    );

    const resetUrl = `${config.publicAppUrl}/reset-password.html?token=${encodeURIComponent(token)}`;
    try {
      await mailer.sendPasswordReset({ to: user.email, name: user.name, resetUrl });
    } catch (err) {
      if (err.code === 'MAIL_NOT_CONFIGURED') {
        throw new HttpError(503, 'MAIL_NOT_CONFIGURED', err.message);
      }
      console.error('[mail] falha ao enviar recuperação:', err.message);
      throw new HttpError(
        502,
        'MAIL_SEND_FAILED',
        'Não foi possível enviar o e-mail agora. Tente de novo em alguns minutos.',
      );
    }

    res.json(generic);
  });

  /** Confere se o token ainda é válido (para a tela de redefinição). */
  router.get('/reset-password/validate', async (req, res) => {
    const token = String(req.query.token || '').trim();
    if (token.length < 20) {
      return res.json({ valid: false, reason: 'INVALID' });
    }
    const row = await db.get(
      `SELECT id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1`,
      [sha256(token)],
    );
    if (!row) return res.json({ valid: false, reason: 'INVALID' });
    if (row.used_at) return res.json({ valid: false, reason: 'USED' });
    if (Number(row.expires_at) <= Date.now()) return res.json({ valid: false, reason: 'EXPIRED' });
    res.json({ valid: true });
  });

  /** Define a nova senha com o token do e-mail. */
  router.post('/reset-password', forgotLimiter, async (req, res) => {
    const { token, password } = parse(schemas.resetPassword, req.body);
    const row = await db.get(
      `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1`,
      [sha256(token)],
    );
    if (!row || row.used_at || Number(row.expires_at) <= Date.now()) {
      throw badRequest(
        'Este link de recuperação é inválido ou já expirou. Solicite uma nova redefinição.',
        { token: 'Link inválido ou expirado.' },
      );
    }

    const passwordHash = await hashPassword(password);
    await db.transaction(async (tx) => {
      await tx.run('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, row.user_id]);
      await tx.run('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [row.id]);
      await tx.run(
        `DELETE FROM password_reset_tokens WHERE user_id = $1 AND id <> $2 AND used_at IS NULL`,
        [row.user_id, row.id],
      );
    });

    // Invalida todas as sessões ativas da conta
    await sessions.destroyAllForUser(row.user_id);
    await sessions.destroy(req.sessionToken);
    res.clearCookie(COOKIE_NAME, cookieOptions(false));

    res.json({
      message: 'Senha alterada com sucesso. Você já pode entrar com a nova senha.',
    });
  });

  return router;
}
