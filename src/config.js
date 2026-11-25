import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function toInt(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Lê as variáveis de ambiente uma única vez e devolve um objeto imutável.
 * Aceita `overrides` para facilitar os testes automatizados.
 */
export function loadConfig(overrides = {}, env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';
  // Na Vercel o sistema de arquivos é somente leitura (exceto /tmp, que é temporário).
  const onVercel = Boolean(env.VERCEL);
  const dataDir = path.resolve(
    onVercel ? '/tmp/estudai' : env.DATA_DIR || path.join(root, 'data'),
  );

  return Object.freeze({
    nodeEnv,
    isProd,
    port: toInt(env.PORT, 3000),
    publicDir: path.join(root, 'public'),
    dataDir,
    // Conexão com o PostgreSQL (Supabase). Nunca escreva a senha no código: use a variável de ambiente.
    databaseUrl: env.DATABASE_URL || '',
    // SSL do banco: automático (ligado fora do localhost). DATABASE_SSL=false desliga.
    databaseSsl: env.DATABASE_SSL ? env.DATABASE_SSL !== 'false' : undefined,
    // Serverless: cada instância abre poucas conexões para não esgotar o limite do banco.
    databasePoolMax: toInt(env.DATABASE_POOL_MAX, onVercel ? 3 : 10),
    uploadDir: path.join(dataDir, 'uploads'),
    uploadMaxBytes: toInt(env.UPLOAD_MAX_MB, 25) * 1024 * 1024,
    sessionDays: toInt(env.SESSION_DAYS, 30),
    // Atrás de proxy (Render, Railway, Nginx...) o Express precisa confiar no X-Forwarded-*.
    // Na Vercel o proxy é sempre usado (necessário para IP real, protocolo https e checagem de Origin).
    trustProxy:
      env.TRUST_PROXY === 'true' || env.TRUST_PROXY === '1' || (onVercel && env.TRUST_PROXY !== 'false'),
    // Cookie "Secure" só funciona em HTTPS; ligado por padrão em produção.
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProd,
    // Origens extras aceitas em requisições que alteram dados (separadas por vírgula).
    allowedOrigins: (env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    rateLimit: { enabled: nodeEnv !== 'test', authMax: 20, windowMs: 15 * 60 * 1000 },
    logFormat: nodeEnv === 'test' ? null : isProd ? 'combined' : 'dev',
    // URL pública do site (links nos e-mails). Ex.: https://meudominio.com ou http://localhost:3000
    publicAppUrl: (
      env.PUBLIC_APP_URL ||
      (env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
      (env.VERCEL_URL && `https://${env.VERCEL_URL}`) ||
      `http://localhost:${toInt(env.PORT, 3000)}`
    ).replace(/\/$/, ''),
    // SMTP real (Gmail, SendGrid, Mailgun...). Sem isso o envio de e-mail não funciona.
    mail: {
      host: env.SMTP_HOST || '',
      port: toInt(env.SMTP_PORT, 587),
      secure: env.SMTP_SECURE === 'true' || env.SMTP_SECURE === '1',
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: env.MAIL_FROM || env.SMTP_USER || 'Estudaí! <noreply@estudai.local>',
      enabled: Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS),
    },
    passwordResetTtlMs: 15 * 60 * 1000,
    // ---- Klyra IA (Groq) ----
    geminiApiKey: env.GROQ_API_KEY || env.GEMINI_API_KEY || '',
    geminiModel: env.GROQ_MODEL || env.GEMINI_MODEL || 'qwen/qwen3.8-27b',
    ...overrides,
  });
}
