import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { CATEGORIES, MATERIAL_AREAS, parse, parseId, schemas } from '../lib/validation.js';
import { requireAuth } from '../middleware/auth.js';

const ALLOWED_EXT = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.odt', '.txt']);
const MAX_LIST = 500;

// Configura o Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

function cleanFileName(raw) {
  const name = Buffer.from(raw, 'latin1').toString('utf8');
  return (
    path
      .basename(name.replace(/\\/g, '/'))
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .slice(0, 150) || 'arquivo'
  );
}

const toApi = (row) => ({
  id: row.id,
  title: row.title,
  area: row.area || 'Outros',
  discipline: row.discipline,
  category: row.category,
  description: row.description,
  fileName: row.file_name,
  fileSize: row.file_size,
  downloads: row.downloads,
  author: row.author_name,
  authorId: row.author_id,
  createdAt: new Date(row.created_at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  mine: Boolean(row.mine),
  canDelete: Boolean(row.mine),
});

export function materialsRouter({ db, config }) {
  const router = Router();

  // Agora o Multer salva na memória para enviarmos direto ao Supabase
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.uploadMaxBytes, files: 1, fields: 10 },
    fileFilter(_req, file, cb) {
      const ext = path.extname(cleanFileName(file.originalname)).toLowerCase();
      if (ALLOWED_EXT.has(ext)) return cb(null, true);
      cb(new HttpError(400, 'INVALID_FILE_TYPE', 'Envie um arquivo PDF, Word, PowerPoint ou texto.'));
    },
  });

  const select = `
    SELECT m.*, u.name AS author_name, (m.author_id = $1) AS mine
      FROM materials m JOIN users u ON u.id = m.author_id`;

  async function byId(id, me) {
    return db.get(`${select} WHERE m.id = $2`, [me, id]);
  }

  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const category = CATEGORIES.includes(req.query.category) ? req.query.category : null;
    const area = MATERIAL_AREAS.includes(req.query.area) ? req.query.area : null;
    const discipline =
      typeof req.query.discipline === 'string' ? req.query.discipline.trim().slice(0, 80) : '';
    const sort = ['recent', 'popular', 'title'].includes(req.query.sort) ? req.query.sort : 'recent';
    const mineOnly = req.query.mine === '1' || req.query.mine === 'true';
    const authorId = req.query.authorId ? parseId(req.query.authorId) : null;

    const order =
      sort === 'popular'
        ? 'm.downloads DESC, m.created_at DESC, m.id DESC'
        : sort === 'title'
          ? 'm.title ASC, m.id DESC'
          : 'm.created_at DESC, m.id DESC';

    const items = (
      await db.all(
        `${select}
       WHERE ($3::text IS NULL OR m.category = $3::text)
         AND ($7::text IS NULL OR m.area = $7::text)
         AND ($2::text = '' OR position(lower(unaccent($2::text)) IN lower(unaccent(m.title || ' ' || COALESCE(m.discipline,'') || ' ' || COALESCE(m.description,'') || ' ' || COALESCE(m.area,'')))) > 0)
         AND ($4::text = '' OR lower(unaccent(m.discipline)) = lower(unaccent($4::text)))
         AND ($5::int = 0 OR m.author_id = $1)
         AND ($6::int IS NULL OR m.author_id = $6)
       ORDER BY ${order}
       LIMIT ${MAX_LIST}`,
        [req.user.id, q, category, discipline, mineOnly ? 1 : 0, authorId, area],
      )
    ).map((row) => {
      const item = toApi(row);
      item.canDelete = item.mine || Boolean(req.user.is_admin);
      return item;
    });

    const { n } = await db.get(
      `SELECT COUNT(*)::int AS n FROM materials m
       WHERE ($2::text IS NULL OR m.category = $2::text)
         AND ($7::text IS NULL OR m.area = $7::text)
         AND ($1::text = '' OR position(lower(unaccent($1::text)) IN lower(unaccent(m.title || ' ' || COALESCE(m.discipline,'') || ' ' || COALESCE(m.description,'') || ' ' || COALESCE(m.area,'')))) > 0)
         AND ($3::text = '' OR lower(unaccent(m.discipline)) = lower(unaccent($3::text)))
         AND ($4::int = 0 OR m.author_id = $5)
         AND ($6::int IS NULL OR m.author_id = $6)`,
      [q, category, discipline, mineOnly ? 1 : 0, req.user.id, authorId, area],
    );

    res.json({ items, total: n, areas: MATERIAL_AREAS });
  });

  router.get('/areas', async (_req, res) => {
    res.json({ items: MATERIAL_AREAS });
  });

  router.get('/disciplines', async (_req, res) => {
    const rows = await db.all(
      `SELECT discipline, COUNT(*)::int AS count
         FROM materials
        GROUP BY discipline
        ORDER BY count DESC, discipline ASC
        LIMIT 100`,
    );
    res.json({ items: rows });
  });

  router.get('/downloads/mine', async (req, res) => {
    const rows = await db.all(
      `SELECT m.*, u.name AS author_name, (m.author_id = $1) AS mine, md.downloaded_at
         FROM material_downloads md
         JOIN materials m ON m.id = md.material_id
         JOIN users u ON u.id = m.author_id
        WHERE md.user_id = $1
        ORDER BY md.downloaded_at DESC
        LIMIT ${MAX_LIST}`,
      [req.user.id],
    );
    res.json({
      items: rows.map((r) => ({
        ...toApi(r),
        downloadedAt: new Date(r.downloaded_at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      })),
    });
  });

  // --- ROTA DE UPLOAD MODIFICADA ---
  router.post('/', upload.single('file'), async (req, res) => {
    const file = req.file;
    try {
      if (!file) throw badRequest('Escolha o arquivo da apostila.');
      if (!supabase) throw new HttpError(500, 'CONFIG_ERROR', 'Supabase não configurado no servidor.');
      
      const data = parse(schemas.material, req.body);
      
      // Gera a chave (apenas o nome do arquivo, sem o prefixo da pasta)
      const storageKey = `${Date.now()}-${randomUUID()}`;

      // 1. Upload para o Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('materials')
        .upload(storageKey, file.buffer, {
          contentType: file.mimetype,
        });

      if (uploadError) {
        console.error('Erro no Supabase Storage:', uploadError);
        throw new HttpError(500, 'UPLOAD_FAILED', 'Não foi possível salvar o arquivo no storage.');
      }

      // 2. Salva no Banco de Dados
      const { id } = await db.get(
        `INSERT INTO materials (title, area, discipline, category, description, file_name, file_size, storage_key, author_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          data.title,
          data.area,
          data.discipline || '',
          data.category,
          data.description,
          cleanFileName(file.originalname),
          file.size,
          storageKey,
          req.user.id,
        ],
      );
      res.status(201).json({ item: toApi(await byId(id, req.user.id)) });
    } catch (err) {
      throw err;
    }
  });

  // --- ROTA DE DOWNLOAD MODIFICADA ---
  router.get('/:id/download', async (req, res) => {
    const row = await byId(parseId(req.params.id), req.user.id);
    if (!row) throw notFound('Apostila não encontrada.');
    
    if (!supabase) throw new HttpError(500, 'CONFIG_ERROR', 'Supabase não configurado no servidor.');

    // Gera um link seguro e temporário do Supabase
    const { data: signedUrlData, error: urlError } = await supabase.storage
      .from('materials')
      .createSignedUrl(row.storage_key, 60); // Link válido por 60 segundos

    if (urlError || !signedUrlData) {
      console.error('Erro no Supabase:', urlError);
      throw notFound('O arquivo desta apostila não está mais disponível.');
    }

    // Contabiliza o download
    await db.transaction(async (tx) => {
      await tx.run('UPDATE materials SET downloads = downloads + 1 WHERE id = $1', [row.id]);
      await tx.run(
        `INSERT INTO material_downloads (user_id, material_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, material_id) DO UPDATE SET downloaded_at = now()`,
        [req.user.id, row.id],
      );
    });

    // Redireciona o usuário para o arquivo no Supabase
    res.redirect(signedUrlData.signedUrl);
  });

  // --- ROTA DE EXCLUSÃO MODIFICADA ---
  router.delete('/:id', async (req, res) => {
    const row = await byId(parseId(req.params.id), req.user.id);
    if (!row) throw notFound('Apostila não encontrada.');
    const isAdmin = Boolean(req.user.is_admin);
    if (!row.mine && !isAdmin) throw forbidden('Só quem enviou a apostila ou um administrador pode excluí-la.');
    
    // Remove do Banco de Dados
    await db.run('DELETE FROM materials WHERE id = $1', [row.id]);
    
    // Remove do Supabase Storage
    if (supabase && row.storage_key) {
      await supabase.storage.from('materials').remove([row.storage_key]);
    }
    
    res.status(204).end();
  });

  return router;
}