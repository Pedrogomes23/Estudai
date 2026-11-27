/**
 * Limpeza de contas que nunca confirmaram o e-mail (e tokens vencidos).
 * TTL: 7 dias após created_at. Contas admin nunca são removidas.
 */

export const UNVERIFIED_ACCOUNT_TTL_DAYS = 7;

/**
 * @param {{ run: Function }} db
 * @returns {Promise<{ usersDeleted: number, tokensDeleted: number }>}
 */
export async function purgeUnverifiedAccounts(db) {
  const tokensDeleted =
    (await db.run(
      `DELETE FROM email_verification_tokens
        WHERE expires_at <= $1 OR used_at IS NOT NULL`,
      [Date.now()],
    )) ?? 0;

  // ON DELETE CASCADE limpa tokens, sessões e demais vínculos do usuário.
  const usersDeleted =
    (await db.run(
      `DELETE FROM users
        WHERE email_verified_at IS NULL
          AND COALESCE(is_admin, false) = false
          AND created_at < (NOW() - INTERVAL '7 days')`,
    )) ?? 0;

  return { usersDeleted, tokensDeleted };
}
