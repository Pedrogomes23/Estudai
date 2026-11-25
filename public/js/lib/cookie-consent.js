/**
 * Aviso de cookies (LGPD). Módulo independente: injeta a própria folha de estilo e o banner,
 * lembra a escolha no navegador e não depende de nenhum outro script do site.
 *
 * Outros scripts podem reagir à escolha:
 *   document.addEventListener('estudai:cookie-consent', (e) => e.detail.choice); // 'all' | 'essential'
 */
const KEY = 'estudai_cookie_consent';
const MAX_AGE_MS = 365 * 86_400_000; // pergunta de novo depois de 12 meses
const POLICY_URL = '/politica-de-cookies.html';
const STYLE_URL = '/css/cookies.css';

function readChoice() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    const valid = saved && ['all', 'essential'].includes(saved.choice) && Date.now() - saved.at < MAX_AGE_MS;
    return valid ? saved.choice : null;
  } catch {
    return null;
  }
}

function saveChoice(choice) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ choice, at: Date.now() }));
  } catch {
    /* navegação privada ou armazenamento bloqueado: o aviso volta na próxima visita */
  }
  document.dispatchEvent(new CustomEvent('estudai:cookie-consent', { detail: { choice } }));
}

function loadStyles() {
  if (document.querySelector(`link[href="${STYLE_URL}"]`)) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLE_URL;
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
    document.head.append(link);
  });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function closeBanner() {
  document.getElementById('ck-banner')?.remove();
}

async function openBanner() {
  if (document.getElementById('ck-banner')) return;
  await loadStyles();

  const banner = el('div', 'ck-banner');
  banner.id = 'ck-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-labelledby', 'ck-title');
  banner.setAttribute('aria-describedby', 'ck-desc');

  const text = el('div', 'ck-text');
  text.append(el('strong', 'ck-title', 'Sua privacidade importa'));
  text.firstChild.id = 'ck-title';
  const desc = el('p', 'ck-desc');
  desc.id = 'ck-desc';
  desc.append(
    'Usamos cookies essenciais para manter você conectado e o site funcionando. ' +
      'Não usamos cookies de publicidade. Saiba mais na ',
  );
  const link = el('a', '', 'Política de Cookies');
  link.href = POLICY_URL;
  desc.append(link, '.');
  text.append(desc);

  const actions = el('div', 'ck-actions');
  const essential = el('button', 'ck-btn', 'Somente essenciais');
  const all = el('button', 'ck-btn ck-primary', 'Aceitar');
  essential.type = all.type = 'button';
  essential.addEventListener('click', () => {
    saveChoice('essential');
    closeBanner();
  });
  all.addEventListener('click', () => {
    saveChoice('all');
    closeBanner();
  });
  actions.append(essential, all);

  banner.append(text, actions);
  document.body.append(banner);
}

/** Acrescenta o link da política ao rodapé das páginas que já têm um (sem alterar o HTML existente). */
function addFooterLinks() {
  for (const footer of document.querySelectorAll('footer, .afoot')) {
    if (footer.querySelector('[data-cookie-policy-link]')) continue;
    const link = el('a', 'ck-link', 'Política de Cookies');
    link.href = POLICY_URL;
    link.dataset.cookiePolicyLink = '';
    footer.append(' · ', link);
  }
}

function init() {
  addFooterLinks();
  // Botões "Gerenciar preferências de cookies" (ex.: na própria página da política).
  document.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-cookie-settings]')) openBanner();
  });
  if (!readChoice()) openBanner();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
