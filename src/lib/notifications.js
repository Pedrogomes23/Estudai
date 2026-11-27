/**
 * Helper mínimo para gravar notificações in-app (sem push, sem som).
 */

/**
 * @param {{ run: Function }} db
 * @param {{ userId: number, type: string, title: string, body?: string, link?: string|null }} opts
 */
export async function notifyUser(db, { userId, type, title, body = '', link = null }) {
  if (!userId || !type || !title) return;
  await db.run(
    `INSERT INTO notifications (user_id, type, title, body, link)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, type, title, body || '', link],
  );
}
