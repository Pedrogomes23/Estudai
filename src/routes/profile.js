import { Router } from 'express';
import { badRequest } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';

export function profileRouter({ db }) {
  const router = Router();
  router.use(requireAuth);

  /** Dados completos da conta autenticada + contadores */
  router.get('/me', async (req, res) => {
    const u = req.user;
    const [row, materials, downloads, joined, owned] = await Promise.all([
      db.get('SELECT id, name, email, COALESCE(bio, \'\') AS bio, COALESCE(is_admin, false) AS is_admin, created_at FROM users WHERE id = $1', [u.id]),
      db.get('SELECT COUNT(*)::int AS n FROM materials WHERE author_id = $1', [u.id]),
      db.get('SELECT COUNT(*)::int AS n FROM material_downloads WHERE user_id = $1', [u.id]).catch(() => ({ n: 0 })),
      db.get('SELECT COUNT(*)::int AS n FROM community_members WHERE user_id = $1', [u.id]),
      db.get('SELECT COUNT(*)::int AS n FROM communities WHERE created_by = $1', [u.id]),
    ]);

    res.json({
      user: {
        id: row.id,
        name: row.name,
        email: row.email,
        bio: row.bio || '',
        isAdmin: Boolean(row.is_admin),
        createdAt: row.created_at
          ? new Date(row.created_at).toISOString().replace(/\.\d{3}Z$/, 'Z')
          : null,
      },
      stats: {
        materials: materials.n,
        downloads: downloads.n,
        communitiesJoined: joined.n,
        communitiesOwned: owned.n,
      },
    });
  });

  /** Atualiza nome e bio */
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

    const updated = await db.get('SELECT id, name, email, bio, is_admin, created_at FROM users WHERE id = $1', [
      req.user.id,
    ]);
    res.json({
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        bio: updated.bio || '',
        isAdmin: Boolean(updated.is_admin),
        createdAt: new Date(updated.created_at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      },
    });
  });

  /** Atividades recentes da conta */
  router.get('/activities', async (req, res) => {
    const uid = req.user.id;
    const [myMaterials, myDownloads, joinedCommunities, newInCommunities] = await Promise.all([
      db.all(
        `SELECT id, title, created_at FROM materials
          WHERE author_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [uid],
      ),
      db.all(
        `SELECT m.id, m.title, md.downloaded_at AS at
           FROM material_downloads md JOIN materials m ON m.id = md.material_id
          WHERE md.user_id = $1 ORDER BY md.downloaded_at DESC LIMIT 5`,
        [uid],
      ),
      db.all(
        `SELECT c.id, c.name, cm.joined_at AS at
           FROM community_members cm JOIN communities c ON c.id = cm.community_id
          WHERE cm.user_id = $1 ORDER BY cm.joined_at DESC LIMIT 5`,
        [uid],
      ),
      db.all(
        `SELECT m.id, m.title, m.created_at AS at, c.name AS community
           FROM materials m
           JOIN community_members cm ON cm.user_id = m.author_id
           JOIN communities c ON c.id = cm.community_id
          WHERE cm.user_id = $1 AND m.author_id <> $1
          ORDER BY m.created_at DESC LIMIT 5`,
        [uid],
      ),
    ]);

    const activities = [
      ...myMaterials.map((r) => ({
        type: 'upload',
        title: r.title,
        at: new Date(r.created_at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        meta: { materialId: r.id },
      })),
      ...myDownloads.map((r) => ({
        type: 'download',
        title: r.title,
        at: new Date(r.at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        meta: { materialId: r.id },
      })),
      ...joinedCommunities.map((r) => ({
        type: 'join',
        title: r.name,
        at: new Date(r.at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        meta: { communityId: r.id },
      })),
      ...newInCommunities.map((r) => ({
        type: 'community_material',
        title: r.title,
        at: new Date(r.at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        meta: { materialId: r.id, community: r.community },
      })),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 12);

    res.json({ items: activities });
  });

  return router;
}
