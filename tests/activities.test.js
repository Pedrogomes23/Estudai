import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formWith, signedInClient, startTestServer } from './helpers.js';

describe('atividades recentes', () => {
  let srv, user, other;
  before(async () => {
    srv = await startTestServer();
    user = (await signedInClient(srv)).client;
    other = (await signedInClient(srv)).client;
  });
  after(() => srv.close());

  it('exige login', async () => {
    assert.equal((await srv.client().get('/api/profile/activities')).status, 401);
  });

  it('começa vazia', async () => {
    const res = await user.get('/api/profile/activities');
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.items, []);
  });

  it('registra entrar, sair, enviar e baixar, só para quem fez', async () => {
    const [community] = (await user.get('/api/communities')).data.items;
    await user.put(`/api/communities/${community.id}/membership`);
    await user.del(`/api/communities/${community.id}/membership`);

    const sent = await user.post('/api/materials', formWith({ title: 'Resumo de teste' }));
    assert.equal(sent.status, 201);
    const download = await user.get(`/api/materials/${sent.data.item.id}/download`);
    assert.equal(download.status, 200);

    const { items } = (await user.get('/api/profile/activities')).data;
    assert.deepEqual(
      items.map((i) => [i.type, i.title]),
      [
        ['download', 'Resumo de teste'],
        ['upload', 'Resumo de teste'],
        ['leave', community.name],
        ['join', community.name],
      ],
    );
    assert.deepEqual((await other.get('/api/profile/activities')).data.items, []);
  });
});
