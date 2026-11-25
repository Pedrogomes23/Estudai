import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signedInClient, startTestServer } from './helpers.js';

describe('chat e participantes da comunidade', () => {
  let srv, owner, member, outsider, room;
  before(async () => {
    srv = await startTestServer();
    owner = await signedInClient(srv);
    member = await signedInClient(srv);
    outsider = await signedInClient(srv);
    const res = await owner.client.post('/api/communities', { name: 'Sala de testes', description: 'Chat.' });
    room = res.data.item;
    await member.client.put(`/api/communities/${room.id}/membership`);
  });
  after(() => srv.close());

  const base = () => `/api/communities/${room.id}`;

  it('detalhe da comunidade mostra se o usuário participa', async () => {
    assert.equal((await owner.client.get(base())).data.item.joined, true);
    assert.equal((await outsider.client.get(base())).data.item.joined, false);
    assert.equal((await owner.client.get('/api/communities/9999')).status, 404);
  });

  it('quem não participa não vê chat nem participantes e não escreve', async () => {
    assert.equal((await outsider.client.get(`${base()}/messages`)).status, 403);
    assert.equal((await outsider.client.get(`${base()}/members`)).status, 403);
    assert.equal((await outsider.client.post(`${base()}/messages`, { body: 'oi' })).status, 403);
  });

  it('exige login', async () => {
    assert.equal((await srv.client().get(`${base()}/messages`)).status, 401);
  });

  it('lista participantes com o criador primeiro', async () => {
    const { items } = (await member.client.get(`${base()}/members`)).data;
    assert.deepEqual(
      items.map((m) => [m.name, m.owner, m.me]),
      [
        [owner.creds.name, true, false],
        [member.creds.name, false, true],
      ],
    );
    assert.ok(
      items.every((m) => !('email' in m)),
      'não expõe e-mails',
    );
  });

  it('chat começa vazio; mensagens aparecem em ordem para todos os membros', async () => {
    assert.deepEqual((await owner.client.get(`${base()}/messages`)).data.items, []);
    const sent = await owner.client.post(`${base()}/messages`, { body: '  Bem-vindos!  ' });
    assert.equal(sent.status, 201);
    assert.equal(sent.data.item.body, 'Bem-vindos!');
    assert.equal(sent.data.item.mine, true);
    assert.match(sent.data.item.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    await member.client.post(`${base()}/messages`, { body: 'Olá!' });
    const seen = (await member.client.get(`${base()}/messages`)).data.items;
    assert.deepEqual(
      seen.map((m) => [m.body, m.mine]),
      [
        ['Bem-vindos!', false],
        ['Olá!', true],
      ],
    );
  });

  it('valida mensagem vazia ou longa demais', async () => {
    assert.equal((await owner.client.post(`${base()}/messages`, { body: '   ' })).status, 400);
    assert.equal((await owner.client.post(`${base()}/messages`, { body: 'x'.repeat(1001) })).status, 400);
  });

  it('guarda texto como texto (sem interpretar HTML)', async () => {
    const res = await member.client.post(`${base()}/messages`, { body: '<img src=x onerror=alert(1)>' });
    assert.equal(res.data.item.body, '<img src=x onerror=alert(1)>');
  });

  it('autor e criador excluem mensagens; os demais não', async () => {
    const mine = (await member.client.post(`${base()}/messages`, { body: 'apagar' })).data.item;
    const fromOwner = (await owner.client.post(`${base()}/messages`, { body: 'do dono' })).data.item;
    assert.equal(mine.canDelete, true);
    assert.equal((await member.client.del(`${base()}/messages/${fromOwner.id}`)).status, 403);
    assert.equal((await owner.client.del(`${base()}/messages/${mine.id}`)).status, 204, 'criador modera');
    assert.equal((await member.client.del(`${base()}/messages/${fromOwner.id}`)).status, 403);
    assert.equal((await owner.client.del(`${base()}/messages/${fromOwner.id}`)).status, 204);
    assert.equal((await owner.client.del(`${base()}/messages/${fromOwner.id}`)).status, 404);
  });

  it('ao sair da comunidade, perde acesso ao chat', async () => {
    await member.client.del(`${base()}/membership`);
    assert.equal((await member.client.get(`${base()}/messages`)).status, 403);
    assert.equal((await owner.client.get(`${base()}/members`)).data.items.length, 1);
  });

  it('mantém só as 100 mensagens mais recentes na listagem', async () => {
    for (let i = 1; i <= 105; i++) await owner.client.post(`${base()}/messages`, { body: `msg ${i}` });
    const { items } = (await owner.client.get(`${base()}/messages`)).data;
    assert.equal(items.length, 100);
    assert.equal(items.at(-1).body, 'msg 105');
  });

  it('excluir a comunidade apaga as mensagens', async () => {
    await owner.client.del(base());
    const { n } = await srv.db.get('SELECT COUNT(*)::int AS n FROM community_messages');
    assert.equal(n, 0);
  });
});
