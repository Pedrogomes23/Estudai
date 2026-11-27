import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const publicDir = path.resolve(import.meta.dirname, '..', 'public');
const appJs = path.resolve(import.meta.dirname, '..', 'src', 'app.js');

test('todas as páginas HTML têm lang="pt-BR", main#conteudo e scripts a11y', () => {
  const pages = fs.readdirSync(publicDir).filter((f) => f.endsWith('.html'));
  assert.ok(pages.length >= 10, 'esperava pelo menos 10 páginas HTML');

  for (const page of pages) {
    const html = fs.readFileSync(path.join(publicDir, page), 'utf8');
    assert.match(html, /lang=["']pt-BR["']/, `${page} sem lang="pt-BR"`);
    assert.match(html, /id=["']conteudo["']/, `${page} sem main#conteudo`);
    assert.match(html, /js\/lib\/vlibras\.js/, `${page} sem vlibras.js`);
    assert.match(html, /js\/lib\/accessibility\.js/, `${page} sem accessibility.js`);
  }
});

test('CSP em src/app.js inclui hosts do VLibras', () => {
  const src = fs.readFileSync(appJs, 'utf8');
  assert.match(src, /vlibras\.gov\.br/, 'CSP sem vlibras.gov.br');
  assert.match(src, /cdn\.jsdelivr\.net/, 'CSP sem cdn.jsdelivr.net');
  assert.match(src, /frame-src/, 'CSP sem frame-src para o widget');
});

test('módulos e página de acessibilidade existem', () => {
  assert.ok(fs.existsSync(path.join(publicDir, 'js/lib/vlibras.js')));
  assert.ok(fs.existsSync(path.join(publicDir, 'js/lib/accessibility.js')));
  assert.ok(fs.existsSync(path.join(publicDir, 'css/accessibility.css')));
  assert.ok(fs.existsSync(path.join(publicDir, 'acessibilidade.html')));
  const policy = fs.readFileSync(path.join(publicDir, 'politica-de-cookies.html'), 'utf8');
  assert.match(policy, /estudai_a11y/);
  assert.match(policy, /VLibras/);
  const sitemap = fs.readFileSync(path.join(publicDir, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /acessibilidade\.html/);
});
