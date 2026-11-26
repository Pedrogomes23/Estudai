import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { createApp } from '../src/app.js';

/**
 * Os testes usam um PostgreSQL de teste (local ou do CI), NUNCA o banco real do Supabase.
 * Cada servidor de teste ganha um schema próprio e isolado, apagado no final.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/estudai_test';

if (/supabase/i.test(TEST_DATABASE_URL)) {
  throw new Error('TEST_DATABASE_URL aponta para o Supabase. Use um PostgreSQL local/de teste.');
}

async function withAdmin(fn) {
  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
}

/** Sobe a aplicação real em porta aleatória, com um schema novo no Postgres de teste e uploads em pasta temporária. */
export async function startTestServer(overrides = {}, options = {}) {
  const sentEmails = [];
  const mailer = options.mailer ?? {
    enabled: true,
    async sendEmailVerification(message) {
      sentEmails.push({ type: 'verification', ...message });
    },
    async sendPasswordReset(message) {
      sentEmails.push({ type: 'password-reset', ...message });
    },
  };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'estudai-test-'));
  const config = loadConfig({
    nodeEnv: 'test',
    dataDir,
    uploadDir: path.join(dataDir, 'uploads'),
    logFormat: null,
    rateLimit: { enabled: false },
    ...overrides,
  });

  const schema = `t_${randomBytes(6).toString('hex')}`;
  await withAdmin(async (admin) => {
    // As extensões ficam no schema public (compartilhadas); cada teste cria só as suas tabelas.
    await admin.query('CREATE EXTENSION IF NOT EXISTS citext');
    await admin.query('CREATE EXTENSION IF NOT EXISTS unaccent');
    await admin.query(`CREATE SCHEMA ${schema}`);

    // Keep migrations isolated inside each temporary test schema.
    await admin.query(`
      CREATE TABLE ${schema}.schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  });
  const db = await openDatabase(TEST_DATABASE_URL, { ssl: false, max: 5, searchPath: `${schema},public` });
  const app = createApp({ config, db, mailer });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    config,
    db,
    sentEmails,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await db.close();
      await withAdmin((admin) => admin.query(`DROP SCHEMA ${schema} CASCADE`));
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
    /** Cliente HTTP com "cookie jar" simples. */
    client() {
      let cookie = '';
      const call = async (method, url, body, extraHeaders = {}) => {
        const isForm = body instanceof FormData;
        const res = await fetch(base + url, {
          method,
          headers: {
            ...(body && !isForm && { 'Content-Type': 'application/json' }),
            ...(cookie && { Cookie: cookie }),
            ...extraHeaders,
          },
          body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
          redirect: 'manual',
        });
        const set = res.headers.getSetCookie?.() ?? [];
        for (const line of set) {
          const [pair] = line.split(';');
          cookie = pair.endsWith('=') ? '' : pair;
        }
        const type = res.headers.get('content-type') || '';
        const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
        return { status: res.status, data, headers: res.headers, setCookie: set };
      };
      return {
        get: (u, h) => call('GET', u, null, h),
        post: (u, b, h) => call('POST', u, b ?? {}, h),
        put: (u) => call('PUT', u, {}),
        del: (u) => call('DELETE', u),
      };
    },
  };
}

let counter = 0;
/** Cria e autentica um usuário novo. */
export async function signedInClient(srv, { remember = false } = {}) {
  const n = ++counter;
  const client = srv.client();
  const creds = { name: `Aluno ${n}`, email: `aluno${n}@exemplo.com`, password: 'senha-segura-123' };
  await client.post('/api/auth/register', creds);
  await srv.db.run('UPDATE users SET email_verified_at = now() WHERE email = $1', [creds.email]);
  await client.post('/api/auth/login', { email: creds.email, password: creds.password, remember });
  return { client, creds };
}

export function formWith({
  title = 'Resumo de SQL',
  discipline = 'Banco de Dados',
  category = 'Resumo',
  description = '',
  name = 'resumo.pdf',
  content = '%PDF-1.4 teste',
} = {}) {
  const form = new FormData();
  form.set('title', title);
  form.set('discipline', discipline);
  form.set('category', category);
  form.set('description', description);
  form.set('file', new Blob([content]), name);
  return form;
}
