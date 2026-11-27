/**
 * Após cada deploy na Vercel, avisa todos os usuários uma única vez (sininho).
 * Usa VERCEL_GIT_COMMIT_SHA / VERCEL_DEPLOYMENT_ID para não repetir.
 */
export async function notifyNewDeployIfNeeded(db) {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    '';
  if (!sha) return { sent: false, reason: 'no-deploy-id' };

  // Só em produção / Vercel
  if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') {
    return { sent: false, reason: 'not-vercel' };
  }

  await db.run(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const prev = await db.get(`SELECT value FROM app_meta WHERE key = 'last_deploy_sha'`);
  if (prev?.value === sha) {
    return { sent: false, reason: 'same-deploy' };
  }

  const title = process.env.DEPLOY_ANNOUNCE_TITLE || 'Atualização no Estudaí!';
  const body =
    process.env.DEPLOY_ANNOUNCE_BODY ||
    'Acabamos de publicar uma nova versão da plataforma. Toque neste aviso para ver os detalhes ou explore as novidades.';

  const notified = await db.run(
    `INSERT INTO notifications (user_id, type, title, body)
     SELECT id, 'site_update', $1, $2 FROM users`,
    [title, body],
  );

  await db.run(
    `INSERT INTO app_meta (key, value, updated_at) VALUES ('last_deploy_sha', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [sha],
  );

  return { sent: true, notified: notified ?? 0, sha };
}
