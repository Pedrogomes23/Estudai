import { Router } from 'express';
import { parseId } from '../lib/validation.js';
import { requireAuth } from '../middleware/auth.js';
import { notFound } from '../lib/errors.js';
import { RELEASE_LINK_PREFIX, findRelease } from '../lib/release-notes.js';

export function notificationsRouter({ db }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const items = await db.all(
      `SELECT id, type, title, body, link, read_at, created_at
         FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [req.user.id],
    );
    const { n: unread } = await db.get(
      'SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [req.user.id],
    );
    res.json({
      items: items.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        body: r.body,
        link: r.link,
        read: Boolean(r.read_at),
        createdAt: new Date(r.created_at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      })),
      unread,
    });
  });

  /** Resumo leve para o navegador checar de tempos em tempos se chegou algo novo. */
  router.get('/summary', async (req, res) => {
    const row = await db.get(
      `SELECT COUNT(*) FILTER (WHERE read_at IS NULL)::int AS unread,
              COALESCE(MAX(id), 0)::int AS latest_id
         FROM notifications
        WHERE user_id = $1`,
      [req.user.id],
    );
    res.set('Cache-Control', 'no-store');
    res.json({ unread: row?.unread ?? 0, latestId: row?.latest_id ?? 0 });
  });

  /** Detalhes de uma notificação de novidade (texto completo do balão). */
  router.get('/:id/release', async (req, res) => {
    const id = parseId(req.params.id);
    const row = await db.get('SELECT link FROM notifications WHERE id = $1 AND user_id = $2', [
      id,
      req.user.id,
    ]);
    if (!row?.link?.startsWith(RELEASE_LINK_PREFIX)) throw notFound('Detalhes não encontrados.');
    const release = findRelease(row.link.slice(RELEASE_LINK_PREFIX.length));
    if (!release) throw notFound('Detalhes não encontrados.');
    res.json({
      release: {
        title: release.title,
        description: release.description,
        items: release.items,
      },
    });
  });

  router.post('/:id/read', async (req, res) => {
    const id = parseId(req.params.id);
    const row = await db.get('SELECT id FROM notifications WHERE id = $1 AND user_id = $2', [
      id,
      req.user.id,
    ]);
    if (!row) throw notFound('Notificação não encontrada.');
    await db.run('UPDATE notifications SET read_at = now() WHERE id = $1 AND read_at IS NULL', [id]);
    res.status(204).end();
  });

  router.post('/read-all', async (req, res) => {
    await db.run('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [
      req.user.id,
    ]);
    res.status(204).end();
  });

  return router;
}
