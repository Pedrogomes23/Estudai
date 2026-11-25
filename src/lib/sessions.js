import { createHash, randomBytes } from 'node:crypto';

export const COOKIE_NAME = 'estudai_sid';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/**
 * Sessões no servidor: o cookie leva um token aleatório e o banco guarda apenas o hash dele.
 * Assim um vazamento do banco não permite sequestrar sessões, e o logout invalida de verdade.
 */
export function createSessionStore(db, { sessionDays }) {
  return {
    async create(userId, remember = false) {
      const token = randomBytes(32).toString('base64url');
      // "Manter conectado" dura `sessionDays`; sem ele, a sessão vale 1 dia e o cookie some ao fechar o navegador.
      const expiresAt = Date.now() + (remember ? sessionDays : 1) * 86_400_000;
      await db.run('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
        sha256(token),
        userId,
        expiresAt,
      ]);
      return { token, expiresAt };
    },
    async find(token) {
      if (!token) return undefined;
      return db.get(
        `SELECT u.id, u.name, u.email, COALESCE(u.is_admin, false) AS is_admin, u.created_at
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id_hash = $1 AND s.expires_at > $2`,
        [sha256(token), Date.now()],
      );
    },
    async destroy(token) {
      if (token) await db.run('DELETE FROM sessions WHERE id_hash = $1', [sha256(token)]);
    },
    /** Encerra todas as sessões de um usuário (ex.: após redefinir a senha). */
    async destroyAllForUser(userId) {
      await db.run('DELETE FROM sessions WHERE user_id = $1', [userId]);
    },
    purgeExpired: () => db.run('DELETE FROM sessions WHERE expires_at <= $1', [Date.now()]),
  };
}
