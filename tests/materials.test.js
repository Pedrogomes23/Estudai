import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formWith, signedInClient, startTestServer } from './helpers.js';

describe('materiais', () => {
  let srv, owner, other;
  before(async () => {
    srv = await startTestServer();
    owner = (await signedInClient(srv)).client;
    other = (await signedInClient(srv)).client;
  });
  after(() => srv.close());

  it('exige login em todas as rotas', async () => {
    const anon = srv.client();
    assert.equal((await anon.get('/api/materials')).status, 401);
    assert.equal((await anon.post('/api/materials', formWith())).status, 401);
    assert.equal((await anon.get('/api/materials/1/download')).status, 401);
  });

  it('lista vazia no início', async () => {
    const res = await owner.get('/api/materials');
    assert.deepEqual(res.data, { items: [], total: 0 });
  });

  let created;
  it('publica um arquivo e preserva acentos no nome', async () => {
    const res = await owner.post(
      '/api/materials',
      formWith({ title: 'Cálculo I', name: 'resumo-cálculo.pdf' }),
    );
    assert.equal(res.status, 201);
    created = res.data.item;
    assert.equal(created.fileName, 'resumo-cálculo.pdf');
    assert.equal(created.mine, true);
    assert.equal(created.downloads, 0);
  });

  it('guarda o arquivo com nome aleatório, fora da pasta pública', () => {
    const files = fs.readdirSync(srv.config.uploadDir);
    assert.equal(files.length, 1);
    assert.match(files[0], /^[0-9a-f-]{36}$/);
  });

  it('busca ignora maiúsculas e acentos e filtra por categoria', async () => {
    await owner.post(
      '/api/materials',
      formWith({ title: 'Normalização', category: 'Apostila', name: 'norm.pdf' }),
    );
    assert.equal((await owner.get('/api/materials?q=CALCULO')).data.items.length, 1);
    assert.equal((await owner.get('/api/materials?category=Apostila')).data.items.length, 1);
    assert.equal((await owner.get('/api/materials?q=banco')).data.items.length, 2);
    const none = await owner.get('/api/materials?q=zzz');
    assert.equal(none.data.items.length, 0);
    assert.equal(none.data.total, 2);
  });

  it('"mine" só é verdadeiro para o autor', async () => {
    const item = (await other.get('/api/materials')).data.items.find((i) => i.id === created.id);
    assert.equal(item.mine, false);
    assert.ok(!('email' in item) && !('authorId' in item), 'não expõe dados do autor além do nome');
  });

  it('baixa o arquivo e incrementa o contador', async () => {
    const res = await other.get(`/api/materials/${created.id}/download`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment/);
    assert.equal(Buffer.from(res.data).toString(), '%PDF-1.4 teste');
    const after = (await other.get('/api/materials')).data.items.find((i) => i.id === created.id);
    assert.equal(after.downloads, 1);
  });

  it('rejeita extensões não permitidas e não deixa arquivo órfão', async () => {
    const before = fs.readdirSync(srv.config.uploadDir).length;
    const res = await owner.post('/api/materials', formWith({ name: 'virus.exe' }));
    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'INVALID_FILE_TYPE');
    assert.equal(fs.readdirSync(srv.config.uploadDir).length, before);
  });

  it('valida campos e remove o upload quando a validação falha', async () => {
    const before = fs.readdirSync(srv.config.uploadDir).length;
    const res = await owner.post('/api/materials', formWith({ title: '' }));
    assert.equal(res.status, 400);
    assert.equal(fs.readdirSync(srv.config.uploadDir).length, before);
    assert.equal((await owner.post('/api/materials', formWith({ category: 'Prova' }))).status, 400);
  });

  it('recusa arquivo acima do limite', async () => {
    const small = await startTestServer({ uploadMaxBytes: 1024 });
    try {
      const { client } = await signedInClient(small);
      const res = await client.post('/api/materials', formWith({ content: 'x'.repeat(5000) }));
      assert.equal(res.status, 413);
      assert.equal(res.data.error.code, 'FILE_TOO_LARGE');
    } finally {
      await small.close();
    }
  });

  it('só o autor exclui; a exclusão apaga o arquivo do disco', async () => {
    assert.equal((await other.del(`/api/materials/${created.id}`)).status, 403);
    assert.equal((await owner.del(`/api/materials/${created.id}`)).status, 204);
    assert.equal((await owner.get(`/api/materials/${created.id}/download`)).status, 404);
    assert.equal(fs.readdirSync(srv.config.uploadDir).length, 1);
  });

  it('rejeita ids inválidos', async () => {
    assert.equal((await owner.get('/api/materials/abc/download')).status, 400);
  });
});
