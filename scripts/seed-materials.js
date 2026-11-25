/**
 * Publica as 10 apostilas de demonstração em nome de contas de estudantes
 * (nunca o admin). Cria os estudantes se ainda não existirem.
 *
 * Uso: node --env-file=.env scripts/seed-materials.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { hashPassword } from '../src/lib/passwords.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SEED_DIR = path.join(ROOT, 'seed', 'materials');
const MANIFEST = path.join(SEED_DIR, 'manifest.json');

// Configura o Supabase para o Seed
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

const STUDENTS = [
  { name: 'Ana Souza', email: 'ana.souza@estudai.demo', password: 'EstudaíDemo2024!' },
  { name: 'Bruno Lima', email: 'bruno.lima@estudai.demo', password: 'EstudaíDemo2024!' },
  { name: 'Carla Mendes', email: 'carla.mendes@estudai.demo', password: 'EstudaíDemo2024!' },
  { name: 'Diego Rocha', email: 'diego.rocha@estudai.demo', password: 'EstudaíDemo2024!' },
];

async function ensureStudent(db, student) {
  const existing = await db.get('SELECT id, name, email, is_admin FROM users WHERE email = $1', [
    student.email,
  ]);
  if (existing) {
    if (existing.is_admin) throw new Error(`Conta ${student.email} é admin — não usar para seed.`);
    return existing.id;
  }
  const passwordHash = await hashPassword(student.password);
  const row = await db.get(
    'INSERT INTO users (name, email, password_hash, is_admin) VALUES ($1, $2, $3, false) RETURNING id',
    [student.name, student.email, passwordHash],
  );
  console.log('  + estudante criado:', student.email);
  return row.id;
}

async function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error('Manifest não encontrado em', MANIFEST);
    process.exit(1);
  }
  if (!supabase) {
    console.error('ERRO: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar definidas no .env');
    process.exit(1);
  }

  const materials = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const config = loadConfig();
  const db = await openDatabase(config.databaseUrl, {
    ssl: config.databaseSsl,
    max: config.databasePoolMax,
  });

  console.log('Garantindo contas de estudantes…');
  const authorIds = [];
  for (const s of STUDENTS) {
    authorIds.push(await ensureStudent(db, s));
  }

  console.log('Publicando materiais…');
  let created = 0;
  for (let i = 0; i < materials.length; i++) {
    const m = materials[i];
    const src = path.join(SEED_DIR, m.file);
    if (!fs.existsSync(src)) {
      console.warn('  ! arquivo ausente:', m.file);
      continue;
    }

    // Evita duplicar pelo título + autor
    const authorId = authorIds[i % authorIds.length];
    const exists = await db.get(
      'SELECT id FROM materials WHERE title = $1 AND author_id = $2',
      [m.title, authorId],
    );
    if (exists) {
      console.log('  = já existe:', m.title);
      continue;
    }

    // Lê o arquivo e prepara o upload para o Supabase
    const fileBuffer = fs.readFileSync(src);
    const stat = fs.statSync(src);
    
    // CORRIGIDO: Removido o prefixo "materials/" para salvar apenas o nome do arquivo
    const storageKey = `${Date.now()}-${randomUUID()}`;

    // 1. Faz o upload para o Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('materials')
      .upload(storageKey, fileBuffer, {
        contentType: m.file.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
      });

    if (uploadError) {
      console.error('  ! Erro no upload para o Supabase:', uploadError.message);
      continue;
    }

    // 2. Salva no Banco de Dados
    await db.run(
      `INSERT INTO materials
        (title, area, discipline, category, description, file_name, file_size, storage_key, author_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        m.title,
        m.area,
        m.discipline || '',
        m.category,
        m.description || '',
        m.file,
        stat.size,
        storageKey,
        authorId,
      ],
    );
    created += 1;
    console.log('  +', m.title, '→', STUDENTS[i % STUDENTS.length].email);
  }

  console.log(`Concluído. ${created} material(is) publicado(s).`);
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});