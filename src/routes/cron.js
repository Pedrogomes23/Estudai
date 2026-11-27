import { Router } from 'express';
import { unauthorized } from '../lib/errors.js';
import { purgeUnverifiedAccounts } from '../lib/janitor.js';

/**
 * Rotas disparadas pelo Vercel Cron (e manualmente em dev com o secret).
 * Protegidas por CRON_SECRET (header Authorization: Bearer <secret>).
 */
export function cronRouter({ db }) {
  const router = Router();

  router.get('/purge-unverified', async (req, res) => {
    const secret = process.env.CRON_SECRET || '';
    const header = req.get('authorization') || '';
    const expected = secret ? `Bearer ${secret}` : '';

    // Sem secret configurado, bloqueia em produção; em dev permite se não houver secret.
    if (secret) {
      if (header !== expected) throw unauthorized('CRON_UNAUTHORIZED', 'Cron não autorizado.');
    } else if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
      throw unauthorized('CRON_UNAUTHORIZED', 'CRON_SECRET não configurado.');
    }

    const sessions = req.app.locals.sessions;
    let sessionsPurged = 0;
    try {
      if (sessions?.purgeExpired) {
        sessionsPurged = (await sessions.purgeExpired()) ?? 0;
      }
    } catch (err) {
      console.error('[cron] sessões:', err.message);
    }

    const { usersDeleted, tokensDeleted } = await purgeUnverifiedAccounts(db);

    console.log(
      `[cron] purge-unverified: users=${usersDeleted} tokens=${tokensDeleted} sessions=${sessionsPurged}`,
    );

    res.json({
      ok: true,
      usersDeleted,
      tokensDeleted,
      sessionsPurged,
      at: new Date().toISOString(),
    });
  });

  return router;
}
