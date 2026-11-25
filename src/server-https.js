import https from 'node:https';
import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { createApp } from './app.js';
import { createHttpsRedirect, loadTlsOptions } from './lib/https.js';

/**
 * Entrada alternativa que serve o site direto em HTTPS (certificado próprio ou Let's Encrypt).
 * Atrás de proxy que já faz o HTTPS (Render, Railway, Fly...) continue usando `npm start`.
 */
const env = process.env;
const toPort = (value, fallback) => Number.parseInt(value ?? '', 10) || fallback;

// Em HTTPS direto o cookie de sessão deve ser "Secure", mesmo fora de produção.
const config = loadConfig({ cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : true });
if (!config.databaseUrl) {
  console.error('DATABASE_URL não definida. Configure a conexão com o PostgreSQL (veja o README).');
  process.exit(1);
}

let tls;
try {
  tls = loadTlsOptions(env);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

let db;
try {
  db = await openDatabase(config.databaseUrl, { ssl: config.databaseSsl, max: config.databasePoolMax });
} catch (err) {
  console.error(`Não foi possível conectar ao banco de dados: ${err.message}`);
  process.exit(1);
}
const app = createApp({ config, db });

const purge = () =>
  app.locals.sessions.purgeExpired().catch((err) => console.error('[sessões]', err.message));
await purge();
const janitor = setInterval(purge, 3_600_000);
janitor.unref();

const httpsPort = toPort(env.HTTPS_PORT, 3443);
const server = https.createServer(tls, app).listen(httpsPort, () => {
  console.log(`Estudaí! no ar em https://localhost:${httpsPort} (${config.nodeEnv})`);
});

// HTTP -> HTTPS (desligue com HTTP_REDIRECT=false).
let redirect;
if (env.HTTP_REDIRECT !== 'false') {
  redirect = createHttpsRedirect({ hostname: new URL(config.publicAppUrl).hostname, httpsPort });
  redirect.listen(config.port, () => {
    console.log(`Redirecionando http://localhost:${config.port} para HTTPS`);
  });
}

// Let's Encrypt renova o certificado a cada ~60 dias: `kill -HUP <pid>` recarrega sem derrubar o site.
process.on('SIGHUP', () => {
  try {
    server.setSecureContext(loadTlsOptions(env));
    console.log('Certificado recarregado.');
  } catch (err) {
    console.error(`Falha ao recarregar o certificado: ${err.message}`);
  }
});

function shutdown(signal) {
  console.log(`${signal} recebido, encerrando...`);
  clearInterval(janitor);
  redirect?.close();
  server.close(async () => {
    await db.close().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
