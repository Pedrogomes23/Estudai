import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { createApp } from '../src/app.js';

/**
 * Ponto de entrada da Vercel (função serverless).
 * Em vez de `app.listen`, o Express é exportado como handler. O banco e o app são
 * criados uma única vez por instância (cold start) e reaproveitados nas requisições seguintes.
 */
let appPromise;

function getApp() {
  appPromise ??= (async () => {
    const config = loadConfig();
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL não definida. Configure-a em Settings > Environment Variables na Vercel.');
    }
    const db = await openDatabase(config.databaseUrl, {
      ssl: config.databaseSsl,
      max: config.databasePoolMax,
    });
    const app = createApp({ config, db });
    // Limpa sessões vencidas (sem bloquear a requisição).
    app.locals.sessions.purgeExpired().catch((err) => console.error('[sessões]', err.message));
    return app;
  })().catch((err) => {
    appPromise = undefined; // permite tentar de novo na próxima requisição
    throw err;
  });
  return appPromise;
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    return app(req, res);
  } catch (err) {
    console.error(`Falha ao iniciar a aplicação: ${err.message}`);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente em instantes.' },
      }),
    );
  }
}
