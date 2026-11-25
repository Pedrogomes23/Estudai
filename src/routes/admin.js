import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';

/**
 * Rotas do painel administrativo.
 * Todas exigem conta com is_admin = true.
 */
export function adminRouter({ db }) {
  const router = Router();

  router.use(requireAdmin);

  /** Estatísticas do dashboard (visão geral + felicidade / feedbacks). */
  router.get('/stats', async (_req, res) => {
    const now = Date.now();
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const [usersLastMonth, activeUsers, communities, totals, feedbackSummary, ratingRows, recentFeedback] =
      await Promise.all([
        db.get(`SELECT COUNT(*)::int AS n FROM users WHERE created_at >= $1`, [monthAgo.toISOString()]),
        db.get(
          `SELECT COUNT(DISTINCT user_id)::int AS n FROM sessions WHERE expires_at > $1`,
          [now],
        ),
        db.get(`SELECT COUNT(*)::int AS n FROM communities`),
        db.get(
          `SELECT
             (SELECT COUNT(*)::int FROM users) AS total_users,
             (SELECT COUNT(*)::int FROM materials) AS total_materials,
             (SELECT COUNT(*)::int FROM community_messages) AS total_messages,
             (SELECT COALESCE(SUM(downloads), 0)::int FROM materials) AS total_downloads`,
        ),
        db.get(
          `SELECT
             COUNT(*)::int AS total,
             COALESCE(ROUND(AVG(rating)::numeric, 2), 0)::float AS average
           FROM feedback`,
        ),
        db.all(
          `SELECT rating, COUNT(*)::int AS n
             FROM feedback
            GROUP BY rating
            ORDER BY rating DESC`,
        ),
        db.all(
          `SELECT f.id, f.rating, f.category, f.area, f.message, f.allow_contact, f.created_at,
                  u.name AS user_name, u.email AS user_email
             FROM feedback f
             JOIN users u ON u.id = f.user_id
            ORDER BY f.created_at DESC, f.id DESC
            LIMIT 50`,
        ),
      ]);

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of ratingRows) {
      distribution[row.rating] = row.n;
    }

    const recentUsers = await db.all(
      `SELECT id, name, email, created_at, is_admin
         FROM users
        ORDER BY created_at DESC, id DESC
        LIMIT 10`,
    );

    const recentCommunities = await db.all(
      `SELECT c.id, c.name, c.created_at, c.is_official,
              u.name AS creator_name,
              (SELECT COUNT(*)::int FROM community_members cm WHERE cm.community_id = c.id) AS members
         FROM communities c
         LEFT JOIN users u ON u.id = c.created_by
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT 10`,
    );

    res.json({
      usersCreatedLastMonth: usersLastMonth.n,
      activeUsersLive: activeUsers.n,
      communitiesCreated: communities.n,
      totalUsers: totals.total_users,
      totalMaterials: totals.total_materials,
      totalMessages: totals.total_messages,
      totalDownloads: totals.total_downloads,
      recentUsers: recentUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        createdAt: u.created_at,
        isAdmin: Boolean(u.is_admin),
      })),
      recentCommunities: recentCommunities.map((c) => ({
        id: c.id,
        name: c.name,
        createdAt: c.created_at,
        isOfficial: Boolean(c.is_official),
        creatorName: c.creator_name || null,
        members: c.members,
      })),
      // Felicidade dos usuários (estilo Play Store, 0–5)
      happiness: {
        average: Number(feedbackSummary.average) || 0,
        total: feedbackSummary.total,
        distribution,
      },
      feedbacks: recentFeedback.map((f) => ({
        id: f.id,
        rating: f.rating,
        category: f.category,
        area: f.area,
        message: f.message,
        allowContact: Boolean(f.allow_contact),
        createdAt: f.created_at,
        userName: f.user_name,
        userEmail: f.user_email,
      })),
    });
  });

  return router;
}
