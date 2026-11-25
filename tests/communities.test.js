import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signedInClient, startTestServer } from './helpers.js';

describe('comunidades', () => {
  let srv, a, b;
  before(async () => {
    srv = await startTestServer();
    a = (await signedInClient(srv)).client;
    b = (await signedInClient(srv)).client;
  });
  after(() => srv.close());

  it('exige login', async () => {
    assert.equal((await srv.client().get('/api/communities')).status, 401);
  });

  it('traz as 4 comunidades iniciais, ainda sem membros', async () => {
    const { items } = (await a.get('/api/communities')).data;
    assert.deepEqual(
      items.map((i) => [i.name, i.members, i.joined]),
      [
        ['Banco de Dados na prática', 0, false],
        ['Lógica de Programação', 0, false],
        ['Projeto Integrador', 0, false],
        ['Preparação para o ENADE', 0, false],
      ],
    );
  });

  it('entrar e sair atualizam a contagem e são idempotentes', async () => {
    const { items } = (await a.get('/api/communities')).data;
    const id = items[0].id;
    const joined = await a.put(`/api/communities/${id}/membership`);
    assert.equal(joined.data.item.members, 1);
    assert.equal(joined.data.item.joined, true);
    assert.equal((await a.put(`/api/communities/${id}/membership`)).data.item.members, 1);
    assert.equal(
      (await b.get('/api/communities')).data.items[0].joined,
      false,
      'cada usuário vê só o próprio estado',
    );
    const left = await a.del(`/api/communities/${id}/membership`);
    assert.equal(left.data.item.members, 0);
    assert.equal(left.data.item.joined, false);
  });

  it('filtro "que participo" e busca', async () => {
    const id = (await a.get('/api/communities')).data.items[2].id;
    await a.put(`/api/communities/${id}/membership`);
    const mine = (await a.get('/api/communities?joined=1')).data.items;
    assert.deepEqual(
      mine.map((i) => i.name),
      ['Projeto Integrador'],
    );
    assert.equal((await a.get('/api/communities?q=programacao')).data.items.length, 1);
  });

  let created;
  it('cria comunidade, já como membro, no topo da lista', async () => {
    const res = await a.post('/api/communities', {
      name: 'Estruturas de Dados',
      description: 'Listas, árvores e grafos.',
    });
    assert.equal(res.status, 201);
    created = res.data.item;
    assert.equal(created.members, 1);
    assert.equal(created.joined, true);
    assert.equal(created.mine, true);
    assert.equal((await a.get('/api/communities')).data.items[0].id, created.id);
  });

  it('impede nomes repetidos (sem diferenciar maiúsculas) e valida campos', async () => {
    const dup = await b.post('/api/communities', { name: 'estruturas de dados', description: 'x' });
    assert.equal(dup.status, 409);
    assert.equal(dup.data.error.code, 'NAME_TAKEN');
    assert.equal((await b.post('/api/communities', { name: '', description: 'x' })).status, 400);
  });

  it('só quem criou exclui; as iniciais não podem ser excluídas', async () => {
    assert.equal((await b.del(`/api/communities/${created.id}`)).status, 403);
    const seed = (await a.get('/api/communities')).data.items.at(-1);
    assert.equal((await a.del(`/api/communities/${seed.id}`)).status, 403);
    assert.equal((await a.del(`/api/communities/${created.id}`)).status, 204);
    assert.equal((await a.put(`/api/communities/${created.id}/membership`)).status, 404);
  });
});
