import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { CATEGORIES, MATERIAL_AREAS, parse, parseId, schemas } from '../lib/validation.js';
import { requireAuth } from '../middleware/auth.js';
import { recordActivity } from '../lib/activities.js';

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

    // Lista e contagem são independentes: rodam ao mesmo tempo (antes, uma esperava a outra).
    const [rows, countRow] = await Promise.all([
      db.all(
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
      ),
      db.get(
        `SELECT COUNT(*)::int AS n FROM materials m
       WHERE ($1::text IS NULL OR m.category = $1::text)
         AND ($2::text IS NULL OR m.area = $2::text)
         AND ($3::text = '' OR lower(unaccent(m.discipline)) = lower(unaccent($3::text)))
         AND ($4::int = 0 OR m.author_id = $5)
         AND ($6::int IS NULL OR m.author_id = $6)`,
        [category, area, discipline, mineOnly ? 1 : 0, req.user.id, authorId],
      ),
    ]);

    const items = rows.map((row) => {
      const item = toApi(row);
      item.canDelete = item.mine || Boolean(req.user.is_admin);
      return item;
    });
    const n = countRow.n;

    res.json({ items, total: n });
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

  router.post('/', upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file) throw badRequest('Escolha o arquivo da apostila.');

    const data = parse(schemas.material, req.body);
    const storageKey = randomUUID();
    const fileName = cleanFileName(file.originalname);
    const localStorage = config.nodeEnv === 'test';

    if (localStorage) {
      await fs.promises.mkdir(config.uploadDir, { recursive: true });
      await fs.promises.writeFile(path.join(config.uploadDir, storageKey), file.buffer);
    } else {
      if (!supabase) {
        throw new HttpError(500, 'CONFIG_ERROR', 'Supabase não configurado no servidor.');
      }

      const { error } = await supabase.storage
        .from('materials')
        .upload(storageKey, file.buffer, { contentType: file.mimetype });

      if (error) {
        console.error('Erro no Supabase Storage:', error);
        throw new HttpError(500, 'UPLOAD_FAILED', 'Não foi possível salvar o arquivo.');
      }
    }

    try {
      const { id } = await db.get(
        `INSERT INTO materials
          (title, area, discipline, category, description, file_name, file_size, storage_key, author_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          data.title,
          data.area,
          data.discipline || '',
          data.category,
          data.description,
          fileName,
          file.size,
          storageKey,
          req.user.id,
        ],
      );

      await recordActivity(db, { userId: req.user.id, type: 'upload', title: data.title });
      res.status(201).json({ item: toApi(await byId(id, req.user.id)) });
    } catch (err) {
      if (localStorage) {
        await fs.promises.rm(path.join(config.uploadDir, storageKey), { force: true });
      } else if (supabase) {
        await supabase.storage.from('materials').remove([storageKey]);
      }
      throw err;
    }
  });

  router.get('/:id/download', async (req, res) => {
    const row = await byId(parseId(req.params.id), req.user.id);
    if (!row) throw notFound('Apostila não encontrada.');

    const localStorage = config.nodeEnv === 'test';

    if (!localStorage && !supabase) {
      throw new HttpError(500, 'CONFIG_ERROR', 'Supabase não configurado no servidor.');
    }

    if (localStorage) {
      const filePath = path.join(config.uploadDir, path.basename(row.storage_key));
      if (!fs.existsSync(filePath)) {
        throw notFound('O arquivo desta apostila não está mais disponível.');
      }

      await db.transaction(async (tx) => {
        await tx.run('UPDATE materials SET downloads = downloads + 1 WHERE id = $1', [row.id]);
        await tx.run(
          `INSERT INTO material_downloads (user_id, material_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id, material_id) DO UPDATE SET downloaded_at = now()`,
          [req.user.id, row.id],
        );
      });

      await recordActivity(db, { userId: req.user.id, type: 'download', title: row.title });
      return res.download(filePath, row.file_name);
    }

    const { data, error } = await supabase.storage
      .from('materials')
      .createSignedUrl(row.storage_key, 60);

    if (error || !data?.signedUrl) {
      console.error('Erro no Supabase:', error);
      throw notFound('O arquivo desta apostila não está mais disponível.');
    }

    await db.transaction(async (tx) => {
      await tx.run('UPDATE materials SET downloads = downloads + 1 WHERE id = $1', [row.id]);
      await tx.run(
        `INSERT INTO material_downloads (user_id, material_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, material_id) DO UPDATE SET downloaded_at = now()`,
        [req.user.id, row.id],
      );
    });

    await recordActivity(db, { userId: req.user.id, type: 'download', title: row.title });
    res.redirect(data.signedUrl);
  });

  router.delete('/:id', async (req, res) => {
    const row = await byId(parseId(req.params.id), req.user.id);
    if (!row) throw notFound('Apostila não encontrada.');

    const isAdmin = Boolean(req.user.is_admin);
    if (!row.mine && !isAdmin) {
      throw forbidden('Só quem enviou a apostila ou um administrador pode excluí-la.');
    }

    if (config.nodeEnv === 'test') {
      await db.run('DELETE FROM materials WHERE id = $1', [row.id]);
      await fs.promises.rm(
        path.join(config.uploadDir, path.basename(row.storage_key)),
        { force: true },
      );
    } else {
      if (!supabase) {
        throw new HttpError(500, 'CONFIG_ERROR', 'Supabase não configurado no servidor.');
      }

      const { error } = await supabase.storage.from('materials').remove([row.storage_key]);
      if (error) {
        console.error('Erro ao remover arquivo do Supabase:', error);
        throw new HttpError(500, 'DELETE_FAILED', 'Não foi possível remover o arquivo.');
      }

      await db.run('DELETE FROM materials WHERE id = $1', [row.id]);
    }

    res.status(204).end();
  });

  return router;
}