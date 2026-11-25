import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { createHttpsRedirect, loadTlsOptions } from '../src/lib/https.js';

const publicDir = path.resolve(import.meta.dirname, '..', 'public');

test('política de cookies existe e descreve o cookie de sessão', () => {
  const html = fs.readFileSync(path.join(publicDir, 'politica-de-cookies.html'), 'utf8');
  assert.match(html, /estudai_sid/);
  assert.match(html, /data-cookie-settings/);
});

test('todas as páginas do site carregam o aviso de cookies', () => {
  const pages = fs.readdirSync(publicDir).filter((f) => f.endsWith('.html') && f !== 'login.html');
  assert.ok(pages.length >= 7);
  for (const page of pages) {
    const html = fs.readFileSync(path.join(publicDir, page), 'utf8');
    assert.match(html, /js\/lib\/cookie-consent\.js/, `${page} sem o aviso de cookies`);
  }
});

test('loadTlsOptions exige as variáveis SSL_*', () => {
  assert.throws(() => loadTlsOptions({}), /SSL_KEY_PATH/);
  assert.throws(
    () => loadTlsOptions({ SSL_KEY_PATH: '/nao/existe', SSL_CERT_PATH: '/nao/existe' }),
    /chave privada/,
  );
});

function opensslAvailable() {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('HTTPS direto e redirecionamento HTTP -> HTTPS', { skip: !opensslAvailable() }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estudai-tls-'));
  execFileSync('sh', [path.resolve(import.meta.dirname, '..', 'scripts', 'generate-dev-cert.sh'), dir], {
    stdio: 'ignore',
  });
  const tls = loadTlsOptions({
    SSL_KEY_PATH: path.join(dir, 'localhost-key.pem'),
    SSL_CERT_PATH: path.join(dir, 'localhost-cert.pem'),
  });

  const secure = https.createServer(tls, (_req, res) => res.end('ok'));
  await new Promise((resolve) => secure.listen(0, '127.0.0.1', resolve));
  const httpsPort = secure.address().port;
  const redirect = createHttpsRedirect({ hostname: 'localhost', httpsPort });
  await new Promise((resolve) => redirect.listen(0, '127.0.0.1', resolve));

  try {
    const body = await new Promise((resolve, reject) => {
      https
        .get({ host: '127.0.0.1', port: httpsPort, rejectUnauthorized: false }, (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve(data));
        })
        .on('error', reject);
    });
    assert.equal(body, 'ok');

    const location = await new Promise((resolve, reject) => {
      http
        .get(
          {
            host: '127.0.0.1',
            port: redirect.address().port,
            path: '/plataforma?x=1',
            headers: { host: 'evil.test' },
          },
          (res) => {
            assert.equal(res.statusCode, 301);
            res.resume();
            resolve(res.headers.location);
          },
        )
        .on('error', reject);
    });
    // Usa o host da configuração, ignorando o cabeçalho Host da requisição.
    assert.equal(location, `https://localhost:${httpsPort}/plataforma?x=1`);
  } finally {
    secure.close();
    redirect.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
