
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { purgeUnverifiedAccounts } from '../src/lib/janitor.js';
import { notifyNewDeployIfNeeded } from '../src/lib/deploy-notify.js';

/**
 * Ponto de entrada da Vercel (função serverless).
 */
let appPromise;

function getApp() {
  appPromise ??= (async () => {
    const config = loadConfig();

    if (!config.databaseUrl) {
      throw new Error(
        'DATABASE_URL não definida. Configure-a em Settings > Environment Variables na Vercel.'
      );
    }

    // Diagnóstico: mostra somente o hostname, nunca a senha.
    try {
      const dbUrl = new URL(config.databaseUrl);
      console.log('[DB CONFIG] Host recebido pela Vercel:', dbUrl.hostname);
    } catch {
      console.error('[DB CONFIG] DATABASE_URL possui formato inválido.');
      throw new Error('DATABASE_URL possui formato inválido.');
    }

    const db = await openDatabase(config.databaseUrl, {
      ssl: config.databaseSsl,
      max: config.databasePoolMax,
    });

    const app = createApp({ config, db });

    app.locals.sessions.purgeExpired().catch((err) =>
      console.error('[sessões]', err.message)
    );
    purgeUnverifiedAccounts(db)
      .then(({ usersDeleted, tokensDeleted }) => {
        if (usersDeleted > 0 || tokensDeleted > 0) {
          console.log(
            `[manutenção] removidas ${usersDeleted} conta(s) não verificada(s), ${tokensDeleted} token(s)`,
          );
        }
      })
      .catch((err) => console.error('[manutenção] contas não verificadas:', err.message));

    notifyNewDeployIfNeeded(db)
      .then((r) => {
        if (r.sent) {
          console.log(`[deploy] aviso de atualização enviado (${r.notified} usuários)`);
        }
      })
      .catch((err) => console.error('[deploy] notify:', err.message));

    return app;
  })().catch((err) => {
    appPromise = undefined;
    throw err;
  });

  return appPromise;
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    return app(req, res);
  } catch (err) {
    console.error('Falha ao iniciar a aplicação:', err);

    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    res.end(
      JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Erro interno. Tente novamente em instantes.',
          detail:
            process.env.NODE_ENV === 'production'
              ? undefined
              : String(err?.message || err),
        },
      })
    );
  }
}
