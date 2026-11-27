import { Router } from 'express';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { badRequest, HttpError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';

const AVATAR_MAX_BYTES = 4 * 1024 * 1024; // 4 MB
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new HttpError(400, 'VALIDATION_ERROR', 'Use JPEG, PNG, WebP ou GIF.'));
      return;
    }
    cb(null, true);
  },
});

async function signedAvatarUrl(key) {
  if (!key || !supabase) return null;
  const { data, error } = await supabase.storage.from('avatars').createSignedUrl(key, 60 * 60 * 24 * 7);
  if (error || !data?.signedUrl) {
    console.error('[avatar] signed url:', error?.message);
    return null;
  }
  return data.signedUrl;
}

function mapUser(row, avatarUrl) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    bio: row.bio || '',
    isAdmin: Boolean(row.is_admin),
    avatarUrl: avatarUrl || null,
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString().replace(/\.\d{3}Z$/, 'Z')
      : null,
  };
}

export function profileRouter({ db }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/me', async (req, res) => {
    const row = await db.get(
      `SELECT u.id, u.name, u.email, COALESCE(u.bio, '') AS bio, u.avatar_key,
              COALESCE(u.is_admin, false) AS is_admin, u.created_at,
              (SELECT COUNT(*)::int FROM materials WHERE author_id = u.id) AS materials_count,
              (SELECT COUNT(*)::int FROM material_downloads WHERE user_id = u.id) AS downloads_count,
              (SELECT COUNT(*)::int FROM community_members WHERE user_id = u.id) AS communities_joined_count,
              (SELECT COUNT(*)::int FROM communities WHERE created_by = u.id) AS communities_owned_count
         FROM users u
        WHERE u.id = $1`,
      [req.user.id],
    );

    const avatarUrl = await signedAvatarUrl(row.avatar_key);

    res.json({
      user: mapUser(row, avatarUrl),
      stats: {
        materials: row.materials_count,
        downloads: row.downloads_count,
        communitiesJoined: row.communities_joined_count,
        communitiesOwned: row.communities_owned_count,
      },
    });
  });

  router.patch('/me', async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : null;
    const bio = typeof req.body?.bio === 'string' ? req.body.bio.trim().slice(0, 500) : null;

    if (name !== null && name.length < 2) throw badRequest('O nome precisa ter pelo menos 2 caracteres.');
    if (name === null && bio === null) throw badRequest('Nada para atualizar.');

    if (name !== null) {
      await db.run('UPDATE users SET name = $1 WHERE id = $2', [name, req.user.id]);
    }
    if (bio !== null) {
      await db.run('UPDATE users SET bio = $1 WHERE id = $2', [bio, req.user.id]);
    }

    const updated = await db.get(
      'SELECT id, name, email, bio, avatar_key, is_admin, created_at FROM users WHERE id = $1',
      [req.user.id],
    );
    res.json({ user: mapUser(updated, await signedAvatarUrl(updated.avatar_key)) });
  });

  /** Upload da foto de perfil (até 4 MB). */
  router.post('/me/avatar', (req, res, next) => {
    upload.single('avatar')(req, res, (err) => {
      if (err) {
        if (err instanceof HttpError) return next(err);
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(badRequest('A foto deve ter no máximo 4 MB.'));
        }
        return next(badRequest(err.message || 'Arquivo inválido.'));
      }
      next();
    });
  }, async (req, res) => {
    if (!req.file) throw badRequest('Selecione uma imagem.');
    if (!supabase) {
      throw new HttpError(500, 'CONFIG_ERROR', 'Armazenamento de imagens não configurado (Supabase).');
    }

    const ext =
      req.file.mimetype === 'image/png'
        ? 'png'
        : req.file.mimetype === 'image/webp'
          ? 'webp'
          : req.file.mimetype === 'image/gif'
            ? 'gif'
            : 'jpg';
    const key = `user-${req.user.id}/avatar.${ext}`;

    const current = await db.get('SELECT avatar_key FROM users WHERE id = $1', [req.user.id]);

    const { error } = await supabase.storage.from('avatars').upload(key, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: true,
    });
    if (error) {
      console.error('[avatar] upload:', error.message);
      throw new HttpError(500, 'UPLOAD_FAILED', 'Não foi possível salvar a foto.');
    }

    // Remove chave antiga se o caminho mudou (ex.: png → jpg)
    if (current?.avatar_key && current.avatar_key !== key) {
      await supabase.storage.from('avatars').remove([current.avatar_key]).catch(() => {});
    }

    await db.run('UPDATE users SET avatar_key = $1 WHERE id = $2', [key, req.user.id]);
    const avatarUrl = await signedAvatarUrl(key);

    res.json({ user: { id: req.user.id, avatarUrl } });
  });

  /** Remove a foto e volta para as iniciais. */
  router.delete('/me/avatar', async (req, res) => {
    const row = await db.get('SELECT avatar_key FROM users WHERE id = $1', [req.user.id]);
    if (row?.avatar_key && supabase) {
      await supabase.storage.from('avatars').remove([row.avatar_key]).catch(() => {});
    }
    await db.run('UPDATE users SET avatar_key = NULL WHERE id = $1', [req.user.id]);
    res.status(204).end();
  });

  return router;
}
