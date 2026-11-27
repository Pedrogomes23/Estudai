import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyNewDeployIfNeeded } from '../src/lib/deploy-notify.js';
import { findRelease, latestRelease, normalizeRelease } from '../src/lib/release-notes.js';

/** Banco falso, só com o que o aviso de deploy usa (não precisa de PostgreSQL). */
function fakeDb({ users = 3, failInsert = false } = {}) {
  const meta = new Map();
  const notifications = [];
  return {
    meta,
    notifications,
    async run(sql, params = []) {
      if (/INSERT INTO notifications/.test(sql)) {
        if (failInsert) throw new Error('falha simulada');
        for (let user = 1; user <= users; user++) {
          notifications.push({ user, title: params[0], body: params[1], link: params[2] });
        }
        return users;
      }
      if (/UPDATE app_meta/.test(sql)) meta.set('last_release_id', params[0]);
      if (/DELETE FROM app_meta/.test(sql)) meta.delete('last_release_id');
      return 0;
    },
    async get(sql, params = []) {
      if (/SELECT value FROM app_meta/.test(sql)) {
        return meta.has('last_release_id') ? { value: meta.get('last_release_id') } : undefined;
      }
      if (/INSERT INTO app_meta/.test(sql)) {
        if (meta.get('last_release_id') === params[0]) return undefined;
        meta.set('last_release_id', params[0]);
        return { value: params[0] };
      }
      return undefined;
    },
  };
}

const RELEASES = [
  { id: 'v2', summary: 'Envio de vídeos.', title: 'Vídeos', items: ['Envie vídeos.'] },
  { id: 'v1', summary: 'Foto de perfil.' },
];

test('envia o resumo da novidade mais nova, com link para os detalhes', async () => {
  process.env.VERCEL = '1';
  const db = fakeDb();
  const r = await notifyNewDeployIfNeeded(db, { releases: RELEASES });
  assert.equal(r.sent, true);
  assert.equal(db.notifications.length, 3);
  assert.equal(db.notifications[0].title, 'Atualização no Estudaí!');
  assert.equal(db.notifications[0].body, 'Envio de vídeos.');
  assert.equal(db.notifications[0].link, 'release:v2');
});

test('não repete o aviso no mesmo release', async () => {
  process.env.VERCEL = '1';
  const db = fakeDb();
  await notifyNewDeployIfNeeded(db, { releases: RELEASES });
  const again = await notifyNewDeployIfNeeded(db, { releases: RELEASES });
  assert.deepEqual(again, { sent: false, reason: 'same-release' });
  assert.equal(db.notifications.length, 3);
});

test('sem novidade cadastrada, não envia nada', async () => {
  process.env.VERCEL = '1';
  const db = fakeDb();
  const r = await notifyNewDeployIfNeeded(db, { releases: [] });
  assert.deepEqual(r, { sent: false, reason: 'no-release' });
  assert.equal(db.notifications.length, 0);
});

test('se o envio falhar, libera para tentar de novo no próximo deploy', async () => {
  process.env.VERCEL = '1';
  const db = fakeDb({ failInsert: true });
  await assert.rejects(() => notifyNewDeployIfNeeded(db, { releases: RELEASES }), /falha simulada/);
  assert.equal(db.meta.has('last_release_id'), false);
});

test('fora da Vercel/produção não envia', async () => {
  delete process.env.VERCEL;
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    const r = await notifyNewDeployIfNeeded(fakeDb(), { releases: RELEASES });
    assert.equal(r.reason, 'not-vercel');
  } finally {
    process.env.NODE_ENV = old;
  }
});

test('normalizeRelease / findRelease / latestRelease', () => {
  assert.equal(normalizeRelease({ id: 'x' }), null);
  assert.equal(findRelease('v1', RELEASES).title, 'Atualização no Estudaí!');
  assert.deepEqual(findRelease('v1', RELEASES).items, []);
  assert.equal(findRelease('nao-existe', RELEASES), null);
  assert.equal(latestRelease(RELEASES).id, 'v2');
  assert.equal(latestRelease([]), null);
});
