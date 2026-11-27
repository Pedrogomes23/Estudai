import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { createApp } from './app.js';
import { purgeUnverifiedAccounts } from './lib/janitor.js';

const config = loadConfig();
if (!config.databaseUrl) {
  console.error('DATABASE_URL não definida. Configure a conexão com o PostgreSQL (veja o README).');
  process.exit(1);
}

let db;
try {
  db = await openDatabase(config.databaseUrl, { ssl: config.databaseSsl, max: config.databasePoolMax });
} catch (err) {
  // Mostra só a mensagem do erro (nunca a URL de conexão, que contém a senha).
  console.error(`Não foi possível conectar ao banco de dados: ${err.message}`);
  process.exit(1);
}
const app = createApp({ config, db });

// Limpa sessões vencidas e contas não verificadas (>7 dias) ao iniciar e a cada hora.
const purge = async () => {
  try {
    await app.locals.sessions.purgeExpired();
  } catch (err) {
    console.error('[sessões]', err.message);
  }
  try {
    const { usersDeleted, tokensDeleted } = await purgeUnverifiedAccounts(db);
    if (usersDeleted > 0 || tokensDeleted > 0) {
      console.log(`[manutenção] removidas ${usersDeleted} conta(s) não verificada(s), ${tokensDeleted} token(s)`);
    }
  } catch (err) {
    console.error('[manutenção] contas não verificadas:', err.message);
  }
};
await purge();
const janitor = setInterval(purge, 3_600_000);
janitor.unref();

const server = app.listen(config.port, () => {
  console.log(`Estudaí! no ar em http://localhost:${config.port} (${config.nodeEnv})`);
});

function shutdown(signal) {
  console.log(`${signal} recebido, encerrando...`);
  clearInterval(janitor);
  server.close(async () => {
    await db.close().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
