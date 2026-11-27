import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { badRequest } from '../lib/errors.js';

/** Quantos usuários aparecem na tabela antes de clicar em "Exibir mais". */
const PREVIEW_USERS = 10;
/** Teto de segurança para a lista completa de usuários. */
const MAX_USERS_LIST = 1000;

/** Devolve a data como ISO (o mesmo formato que o driver `pg` entregava antes). */
const iso = (value) => (value ? new Date(value).toISOString() : null);

const mapUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  createdAt: iso(u.created_at),
  isAdmin: Boolean(u.is_admin),
});

/**
 * Rotas do painel administrativo.
 * Todas exigem conta com is_admin = true.
 */
export function adminRouter({ db }) {
  const router = Router();

  router.use(requireAdmin);

  /**
   * Estatísticas do dashboard (visão geral + felicidade / feedbacks).
   *
   * Tudo é buscado em UMA única consulta (uma ida ao banco). Antes eram 9 consultas:
   * com o pool pequeno da Vercel (3 conexões) elas ficavam na fila e cada conexão nova
   * com o Supabase custa um handshake TCP+SSL, então o tempo se multiplicava.
   */
  router.get('/stats', async (_req, res) => {
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const row = await db.get(
      `SELECT
         (SELECT COUNT(*)::int FROM users WHERE created_at >= $1) AS users_last_month,
         (SELECT COUNT(DISTINCT user_id)::int FROM sessions WHERE expires_at > $2) AS active_users,
         (SELECT COUNT(*)::int FROM communities) AS communities,
         (SELECT COUNT(*)::int FROM users) AS total_users,
         (SELECT COUNT(*)::int FROM materials) AS total_materials,
         (SELECT COUNT(*)::int FROM community_messages) AS total_messages,
         (SELECT COALESCE(SUM(downloads), 0)::int FROM materials) AS total_downloads,
         (SELECT COUNT(*)::int FROM feedback) AS feedback_total,
         (SELECT COALESCE(ROUND(AVG(rating)::numeric, 2), 0)::float FROM feedback) AS feedback_average,
         (SELECT COALESCE(json_object_agg(r.rating, r.n), '{}'::json)
            FROM (SELECT rating, COUNT(*)::int AS n FROM feedback GROUP BY rating) r) AS rating_distribution,
         (SELECT COALESCE(json_agg(x ORDER BY x.created_at DESC, x.id DESC), '[]'::json)
            FROM (SELECT id, name, email, created_at, is_admin
                    FROM users
                   ORDER BY created_at DESC, id DESC
                   LIMIT $3) x) AS recent_users,
         (SELECT COALESCE(json_agg(x ORDER BY x.created_at DESC, x.id DESC), '[]'::json)
            FROM (SELECT c.id, c.name, c.created_at, c.is_official,
                         u.name AS creator_name,
                         (SELECT COUNT(*)::int FROM community_members cm WHERE cm.community_id = c.id) AS members
                    FROM communities c
                    LEFT JOIN users u ON u.id = c.created_by
                   ORDER BY c.created_at DESC, c.id DESC
                   LIMIT 10) x) AS recent_communities,
         (SELECT COALESCE(json_agg(x ORDER BY x.created_at DESC, x.id DESC), '[]'::json)
            FROM (SELECT f.id, f.rating, f.category, f.area, f.message, f.allow_contact, f.created_at,
                         u.name AS user_name, u.email AS user_email
                    FROM feedback f
                    JOIN users u ON u.id = f.user_id
                   ORDER BY f.created_at DESC, f.id DESC
                   LIMIT 50) x) AS recent_feedback`,
      [monthAgo.toISOString(), Date.now(), PREVIEW_USERS],
    );

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const [rating, n] of Object.entries(row.rating_distribution || {})) {
      distribution[rating] = n;
    }

    res.json({
      usersCreatedLastMonth: row.users_last_month,
      activeUsersLive: row.active_users,
      communitiesCreated: row.communities,
      totalUsers: row.total_users,
      totalMaterials: row.total_materials,
      totalMessages: row.total_messages,
      totalDownloads: row.total_downloads,
      // Só os mais recentes; a lista completa vem de GET /api/admin/users ("Exibir mais").
      recentUsers: row.recent_users.map(mapUser),
      recentCommunities: row.recent_communities.map((c) => ({
        id: c.id,
        name: c.name,
        createdAt: iso(c.created_at),
        isOfficial: Boolean(c.is_official),
        creatorName: c.creator_name || null,
        members: c.members,
      })),
      // Felicidade dos usuários (estilo Play Store, 0–5)
      happiness: {
        average: Number(row.feedback_average) || 0,
        total: row.feedback_total,
        distribution,
      },
      feedbacks: row.recent_feedback.map((f) => ({
        id: f.id,
        rating: f.rating,
        category: f.category,
        area: f.area,
        message: f.message,
        allowContact: Boolean(f.allow_contact),
        createdAt: iso(f.created_at),
        userName: f.user_name,
        userEmail: f.user_email,
      })),
    });
  });

  /** Lista completa de usuários — só é chamada quando o admin clica em "Exibir mais". */
  router.get('/users', async (_req, res) => {
    const users = await db.all(
      `SELECT id, name, email, created_at, is_admin
         FROM users
        ORDER BY created_at DESC, id DESC
        LIMIT $1`,
      [MAX_USERS_LIST],
    );
    res.json({ items: users.map(mapUser) });
  });


  /** Aviso de atualização do site → notificação no sininho de todos. */
  router.post('/announcements', async (req, res) => {
    const title = String(req.body?.title || '').trim().slice(0, 120);
    const body = String(req.body?.body || '').trim().slice(0, 2000);
    if (!title || !body) {
      throw badRequest('Informe título e mensagem do aviso.');
    }

    const notified = await db.run(
      `INSERT INTO notifications (user_id, type, title, body)
       SELECT id, 'site_update', $1, $2 FROM users`,
      [title, body],
    );

    res.status(201).json({ message: 'Aviso enviado a todos os usuários.', notified: notified ?? 0 });
  });

  return router;
}
