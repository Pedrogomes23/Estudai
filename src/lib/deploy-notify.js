import { RELEASE_LINK_PREFIX, latestRelease } from './release-notes.js';

const TITLE = 'Atualização no Estudaí!';

/**
 * Após um deploy na Vercel, avisa todos os usuários (sininho) UMA vez por novidade.
 * O texto vem de src/lib/release-notes.js: a entrada mais nova da lista vira o aviso.
 * Sem entrada nova, nada é enviado.
 */
export async function notifyNewDeployIfNeeded(db, { releases } = {}) {
  // Só em produção / Vercel
  if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') {
    return { sent: false, reason: 'not-vercel' };
  }

  const release = latestRelease(releases);
  if (!release) return { sent: false, reason: 'no-release' };

  await db.run(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const previous = await db.get(`SELECT value FROM app_meta WHERE key = 'last_release_id'`);

  // "Reserva" a novidade de forma atômica: se duas instâncias subirem juntas, só uma envia.
  const claimed = await db.get(
    `INSERT INTO app_meta (key, value, updated_at) VALUES ('last_release_id', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       WHERE app_meta.value <> EXCLUDED.value
     RETURNING value`,
    [release.id],
  );
  if (!claimed) return { sent: false, reason: 'same-release' };

  try {
    const notified = await db.run(
      `INSERT INTO notifications (user_id, type, title, body, link)
       SELECT id, 'site_update', $1, $2, $3 FROM users`,
      [TITLE, release.summary, `${RELEASE_LINK_PREFIX}${release.id}`],
    );
    return { sent: true, notified: notified ?? 0, releaseId: release.id };
  } catch (err) {
    // Desfaz a reserva para a próxima subida tentar de novo.
    if (previous?.value) {
      await db
        .run(`UPDATE app_meta SET value = $1, updated_at = now() WHERE key = 'last_release_id'`, [
          previous.value,
        ])
        .catch(() => {});
    } else {
      await db.run(`DELETE FROM app_meta WHERE key = 'last_release_id'`).catch(() => {});
    }
    throw err;
  }
}
