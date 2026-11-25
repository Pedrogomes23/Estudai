import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

describe('aplicação', () => {
  let srv;
  before(async () => (srv = await startTestServer()));
  after(() => srv.close());

  it('health check', async () => {
    const res = await srv.client().get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.data.status, 'ok');
  });

  it('rota de API desconhecida devolve JSON 404', async () => {
    const res = await srv.client().get('/api/nada');
    assert.equal(res.status, 404);
    assert.equal(res.data.error.code, 'NOT_FOUND');
  });

  it('envia cabeçalhos de segurança e CSP restritiva', async () => {
    const res = await srv.client().get('/api/health');
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  it('JSON malformado retorna 400 em vez de 500', async () => {
    const res = await fetch(`${srv.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ quebrado',
    });
    assert.equal(res.status, 400);
  });

  it('serve as páginas do front-end', async () => {
    for (const route of [
      '/',
      '/index.html',
      '/plataforma',
      '/plataforma.html',
      '/robots.txt',
      '/sitemap.xml',
    ]) {
      const res = await fetch(srv.base + route);
      assert.equal(res.status, 200, route);
    }
  });

  it('não expõe o código-fonte do servidor nem os uploads', async () => {
    for (const route of ['/src/app.js', '/package.json', '/data/estudai.db', '/uploads/']) {
      assert.equal((await fetch(srv.base + route)).status, 404, route);
    }
  });
});
