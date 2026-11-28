/**
 * Histórico de atividades do usuário (entrar/sair de comunidade, baixar e enviar arquivo).
 * Gravar a atividade nunca pode derrubar a ação principal: erros só vão para o log.
 */

export const ACTIVITY_TYPES = ['upload', 'download', 'join', 'leave'];

/**
 * @param {{ run: Function }} db
 * @param {{ userId: number, type: string, title: string, community?: string|null }} opts
 */
export async function recordActivity(db, { userId, type, title, community = null }) {
  if (!userId || !ACTIVITY_TYPES.includes(type) || !title) return;
  try {
    await db.run(
      'INSERT INTO user_activities (user_id, type, title, community) VALUES ($1, $2, $3, $4)',
      [userId, type, String(title).slice(0, 200), community],
    );
  } catch (err) {
    console.error('[atividades] não foi possível gravar:', err.message);
  }
}

export async function listActivities(db, userId, limit = 15) {
  const rows = await db.all(
    `SELECT type, title, community, created_at
       FROM user_activities
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    type: r.type,
    title: r.title,
    at: new Date(r.created_at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    meta: r.community ? { community: r.community } : {},
  }));
}
