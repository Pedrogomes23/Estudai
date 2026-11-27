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
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const WELCOME_TITLE = 'Bem-vindo(a) ao Estudaí! 🎉';
const WELCOME_BODY =
  'Que bom ter você aqui! Explore materiais, entre em comunidades de estudo, compartilhe seus resumos e converse com a Klyra IA. Qualquer dúvida, é só chamar pelo Feedback. Bons estudos!';

const publicUser = ({ id, name, email, bio, is_admin, created_at }) => ({
  id,
  name,
  email,
  isAdmin: Boolean(is_admin),
  bio: bio ?? '',
  createdAt: created_at ? new Date(created_at).toISOString().replace(/\.\d{3}Z$/, 'Z') : null,
});

export function authRouter({ db, config, sessions, mailer: injectedMailer }) {
  const router = Router();
  const mailer = injectedMailer ?? createMailer(config);

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

  const issueEmailVerification = async (user) => {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + EMAIL_VERIFICATION_TTL_MS;

    const created = await db.transaction(async (tx) => {
      const current = await tx.get('SELECT id, email_verified_at FROM users WHERE id = $1 FOR UPDATE', [
        user.id,
      ]);

      if (!current || current.email_verified_at) return false;

      await tx.run('DELETE FROM email_verification_tokens WHERE user_id = $1 AND used_at IS NULL', [user.id]);

      await tx.run(
        'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [user.id, sha256(token), expiresAt],
      );

      return true;
    });

    if (!created) return false;

    const verificationUrl = new URL('/confirm-email.html', config.publicAppUrl);
    verificationUrl.searchParams.set('token', token);

    try {
      await mailer.sendEmailVerification({
        to: user.email,
        name: user.name,
        verificationUrl: verificationUrl.toString(),
      });
    } catch (err) {
      console.error('[mail] falha ao enviar confirmação:', err.message);
      if (err.code === 'MAIL_NOT_CONFIGURED') {
        throw new HttpError(503, 'MAIL_NOT_CONFIGURED', err.message);
      }
      throw new HttpError(
        502,
        'MAIL_SEND_FAILED',
        'Não foi possível enviar o e-mail agora. Você poderá solicitar outro link.',
      );
    }

    return true;
  };

  router.post('/register', limiter, async (req, res) => {
    const { name, email, password } = parse(schemas.register, req.body);
    const emailTaken = () =>
      conflict('EMAIL_TAKEN', 'Já existe uma conta com esse e-mail. Use a aba Entrar.');

    if (!mailer.enabled) {
      throw new HttpError(
        503,
        'MAIL_NOT_CONFIGURED',
        'O envio de e-mails está temporariamente indisponível.',
      );
    }

    if (await findByEmail(email)) throw emailTaken();

    const hash = await hashPassword(password);
    let created;
    try {
      created = await db.get(
        'INSERT INTO users (name, email, password_hash, email_verified_at) VALUES ($1, $2, $3, NULL) RETURNING id',
        [name, email, hash],
      );
    } catch (err) {
      if (isConstraintError(err)) throw emailTaken();
      throw err;
    }

    await issueEmailVerification({ id: created.id, name, email });
    res.status(201).json({
      user: { id: created.id, name, email },
      message: 'Conta criada. Enviamos um link para confirmar seu e-mail.',
    });
  });

  router.post('/login', limiter, async (req, res) => {
    const { email, password, remember } = parse(schemas.login, req.body);
    const user = await findByEmail(email);

    if (!user) {
      await verifyPassword(password, DUMMY_HASH); // iguala o tempo de resposta
      throw unauthorized('INVALID_CREDENTIALS', 'E-mail ou senha incorretos.');
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      throw unauthorized('INVALID_CREDENTIALS', 'E-mail ou senha incorretos.');
    }

    if (!user.email_verified_at) {
      throw new HttpError(
        403,
        'EMAIL_NOT_VERIFIED',
        'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada ou solicite um novo link.',
      );
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

  // ---- Confirmação de e-mail ----

  router.get('/verify-email/validate', async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';

    if (token.length < 20 || token.length > 256) {
      return res.json({ valid: false, reason: 'INVALID' });
    }

    const row = await db.get(
      `SELECT t.expires_at, t.used_at, u.email_verified_at
       FROM email_verification_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1`,
      [sha256(token)],
    );

    if (!row) return res.json({ valid: false, reason: 'INVALID' });
    if (row.used_at || row.email_verified_at) {
      return res.json({ valid: false, reason: 'USED' });
    }
    if (Number(row.expires_at) <= Date.now()) {
      return res.json({ valid: false, reason: 'EXPIRED' });
    }

    return res.json({ valid: true });
  });

  router.post('/verify-email', forgotLimiter, async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';

    if (token.length < 20 || token.length > 256) {
      throw badRequest('Link de confirmação inválido ou expirado.');
    }

    await db.transaction(async (tx) => {
      const consumed = await tx.get(
        `UPDATE email_verification_tokens
         SET used_at = now()
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
         RETURNING user_id`,
        [sha256(token), Date.now()],
      );

      if (!consumed) {
        throw badRequest('Link de confirmação inválido, expirado ou já utilizado.');
      }

      await tx.run('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [
        consumed.user_id,
      ]);

      await tx.run('DELETE FROM email_verification_tokens WHERE user_id = $1 AND used_at IS NULL', [
        consumed.user_id,
      ]);

      // Primeira notificação da conta: boas-vindas (só uma vez por usuário).
      await tx.run(
        `INSERT INTO notifications (user_id, type, title, body, link)
         SELECT $1::int, 'welcome', $2::text, $3::text, NULL
          WHERE NOT EXISTS (
            SELECT 1 FROM notifications WHERE user_id = $1::int AND type = 'welcome'
          )`,
        [consumed.user_id, WELCOME_TITLE, WELCOME_BODY],
      );
    });

    res.json({ message: 'E-mail confirmado com sucesso. Você já pode entrar.' });
  });

  router.post('/resend-verification', forgotLimiter, async (req, res) => {
    const { email } = parse(schemas.forgotPassword, req.body);
    const generic = {
      message:
        'Se existir uma conta aguardando confirmação, enviaremos um novo link. Confira sua caixa de entrada e o spam.',
    };

    if (!mailer.enabled) {
      await verifyPassword('x', DUMMY_HASH);
      return res.json(generic);
    }

    const user = await findByEmail(email);
    if (!user || user.email_verified_at) {
      await verifyPassword('x', DUMMY_HASH);
      return res.json(generic);
    }

    try {
      await issueEmailVerification(user);
    } catch (err) {
      console.error('[mail] falha no reenvio de confirmação:', err.message);
    }

    return res.json(generic);
  });

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

    if (!mailer.enabled) {
      await verifyPassword('x', DUMMY_HASH);
      return res.json(generic);
    }

    const user = await findByEmail(email);
    if (!user) {
      await verifyPassword('x', DUMMY_HASH);
      return res.json(generic);
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + config.passwordResetTtlMs;

    await db.transaction(async (tx) => {
      // Serializa solicitações simultâneas de recuperação para a mesma conta.
      await tx.get('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      await tx.run(`DELETE FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL`, [user.id]);
      await tx.run(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [user.id, sha256(token), expiresAt],
      );
    });

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
      throw badRequest('Este link de recuperação é inválido ou já expirou. Solicite uma nova redefinição.', {
        token: 'Link inválido ou expirado.',
      });
    }

    const passwordHash = await hashPassword(password);
    await db.transaction(async (tx) => {
      const consumed = await tx.get(
        `UPDATE password_reset_tokens
         SET used_at = now()
         WHERE id = $1 AND used_at IS NULL AND expires_at > $2
         RETURNING user_id`,
        [row.id, Date.now()],
      );

      if (!consumed) {
        throw badRequest(
          'Este link de recuperação é inválido ou já expirou. Solicite uma nova redefinição.',
          { token: 'Link inválido ou expirado.' },
        );
      }

      await tx.run('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, consumed.user_id]);
      await tx.run(`DELETE FROM password_reset_tokens WHERE user_id = $1 AND id <> $2 AND used_at IS NULL`, [
        consumed.user_id,
        row.id,
      ]);
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
