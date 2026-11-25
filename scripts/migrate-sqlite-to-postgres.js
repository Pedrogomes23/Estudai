/**
 * Copia os dados do SQLite antigo para o PostgreSQL (uso único).
 *
 *   node --env-file=.env scripts/migrate-sqlite-to-postgres.js [caminho/do/estudai.db]
 *
 * - Só LÊ o SQLite (trabalha numa cópia temporária; o original não é tocado).
 * - Mantém os mesmos IDs, então os relacionamentos continuam corretos.
 * - Não copia `sessions`: quem estava logado apenas faz login de novo.
 * - Se o Postgres já tiver usuários, para sem mudar nada.
 * - Tudo acontece numa transação: ou copia tudo, ou não copia nada.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDb, migrate } from '../src/db/index.js';

const sqliteDate = (s) => `${s.replace(' ', 'T')}Z`; // 'YYYY-MM-DD HH:MM:SS' (UTC) -> ISO

const source = path.resolve(process.argv[2] || 'data/estudai.db');
if (!fs.existsSync(source)) {
  console.error(`Arquivo SQLite não encontrado: ${source}`);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não definida (rode com --env-file=.env).');
  process.exit(1);
}

// Copia o .db junto com -wal e -shm para uma pasta temporária e lê a cópia.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'estudai-sqlite-'));
for (const ext of ['', '-wal', '-shm']) {
  if (fs.existsSync(source + ext)) fs.copyFileSync(source + ext, path.join(tmp, `estudai.db${ext}`));
}
const sqlite = new DatabaseSync(path.join(tmp, 'estudai.db'));

const ssl = process.env.DATABASE_SSL ? process.env.DATABASE_SSL !== 'false' : undefined;
const db = createDb(process.env.DATABASE_URL, { ssl, max: 2 });

try {
  await migrate(db); // garante que as tabelas existem (não cria comunidades de exemplo)

  const { n: existing } = await db.get('SELECT COUNT(*)::int AS n FROM users');
  if (existing > 0) {
    console.error(`O PostgreSQL já tem ${existing} usuário(s). Para evitar duplicar dados, nada foi feito.`);
    process.exitCode = 1;
  } else {
    const read = (sql) => sqlite.prepare(sql).all();
    const users = read('SELECT * FROM users ORDER BY id');
    const materials = read('SELECT * FROM materials ORDER BY id');
    const communities = read('SELECT * FROM communities ORDER BY id');
    const members = read('SELECT * FROM community_members');
    const messages = read('SELECT * FROM community_messages ORDER BY id');

    await db.transaction(async (tx) => {
      // As comunidades oficiais podem já existir se o app chegou a iniciar; recomeça do zero.
      await tx.run('DELETE FROM communities');

      for (const u of users) {
        await tx.run(
          'INSERT INTO users (id, name, email, password_hash, created_at) VALUES ($1,$2,$3,$4,$5)',
          [u.id, u.name, u.email, u.password_hash, sqliteDate(u.created_at)],
        );
      }
      for (const c of communities) {
        await tx.run(
          `INSERT INTO communities (id, name, description, base_members, is_official, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            c.id,
            c.name,
            c.description,
            c.base_members,
            Boolean(c.is_official),
            c.created_by,
            sqliteDate(c.created_at),
          ],
        );
      }
      for (const m of members) {
        await tx.run('INSERT INTO community_members (community_id, user_id, joined_at) VALUES ($1,$2,$3)', [
          m.community_id,
          m.user_id,
          sqliteDate(m.joined_at),
        ]);
      }
      for (const m of messages) {
        await tx.run(
          'INSERT INTO community_messages (id, community_id, user_id, body, created_at) VALUES ($1,$2,$3,$4,$5)',
          [m.id, m.community_id, m.user_id, m.body, sqliteDate(m.created_at)],
        );
      }
      for (const m of materials) {
        await tx.run(
          `INSERT INTO materials (id, title, discipline, category, description, file_name, file_size,
                                  storage_key, downloads, author_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            m.id,
            m.title,
            m.discipline,
            m.category,
            m.description,
            m.file_name,
            m.file_size,
            m.storage_key,
            m.downloads,
            m.author_id,
            sqliteDate(m.created_at),
          ],
        );
      }

      // Como os IDs foram copiados na mão, avança os contadores para os próximos IDs não colidirem.
      for (const table of ['users', 'communities', 'materials', 'community_messages']) {
        await tx.get(
          `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`,
        );
      }
    });

    console.log('Dados copiados. Conferência (SQLite -> PostgreSQL):');
    const checks = [
      ['users', users.length],
      ['communities', communities.length],
      ['community_members', members.length],
      ['community_messages', messages.length],
      ['materials', materials.length],
    ];
    let ok = true;
    for (const [table, expected] of checks) {
      const { n } = await db.get(`SELECT COUNT(*)::int AS n FROM ${table}`);
      if (n !== expected) ok = false;
      console.log(`  ${table.padEnd(20)} ${expected} -> ${n} ${n === expected ? 'OK' : 'DIVERGENTE'}`);
    }
    if (!ok) process.exitCode = 1;
    if (materials.length > 0) {
      console.log(
        '\nAtenção: existem apostilas. Os registros foram copiados, mas os ARQUIVOS (data/uploads) não vão para o banco.',
      );
    }
  }
} catch (err) {
  console.error(`Falhou (nada foi gravado): ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
  sqlite.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
