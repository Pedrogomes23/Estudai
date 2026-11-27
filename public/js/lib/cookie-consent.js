/**
 * Aviso de cookies (LGPD). Módulo independente: injeta a própria folha de estilo e o banner,
 * lembra a escolha no navegador e não depende de nenhum outro script do site.
 *
 * Outros scripts podem reagir à escolha:
 *   document.addEventListener('estudai:cookie-consent', (e) => e.detail);
 *   // { choice: 'all' | 'essential' | 'custom', categories: { necessary, analytics, marketing } }
 *
 * Qualquer script futuro que use cookies não essenciais deve consultar `window.estudaiCookieConsent()`.
 */
const KEY = 'estudai_cookie_consent';
const VERSION = 2; // aumente quando a política mudar de forma relevante: o aviso volta a aparecer
const MAX_AGE_MS = 365 * 86_400_000; // pergunta de novo depois de 12 meses
const POLICY_URL = '/politica-de-cookies.html';
const STYLE_URL = '/css/cookies.css';

const CATEGORIES = [
  {
    id: 'necessary',
    name: 'Estritamente necessários',
    locked: true,
    text: 'Mantêm você conectado e guardam a sua escolha neste aviso: ',
    cookies: ['estudai_sid', 'estudai_cookie_consent'],
  },
  {
    id: 'analytics',
    name: 'Estatísticas e desempenho',
    text: 'Ajudam a entender como o site é usado, para melhorá-lo.',
    none: 'Não usamos no momento. Sua escolha fica registrada caso isso mude.',
  },
  {
    id: 'marketing',
    name: 'Publicidade',
    text: 'Servem para mostrar anúncios e acompanhar campanhas.',
    none: 'Não usamos no momento. Sua escolha fica registrada caso isso mude.',
  },
];

const ESSENTIAL_ONLY = { necessary: true, analytics: false, marketing: false };
const ALL = { necessary: true, analytics: true, marketing: true };

function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    const valid =
      saved &&
      saved.version === VERSION &&
      ['all', 'essential', 'custom'].includes(saved.choice) &&
      Date.now() - saved.at < MAX_AGE_MS;
    return valid ? saved : null;
  } catch {
    return null;
  }
}

function saveChoice(choice, categories) {
  const detail = { choice, categories: { ...categories, necessary: true } };
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...detail, version: VERSION, at: Date.now() }));
  } catch {
    /* navegação privada ou armazenamento bloqueado: o aviso volta na próxima visita */
  }
  document.dispatchEvent(new CustomEvent('estudai:cookie-consent', { detail }));
}

window.estudaiCookieConsent = () => readSaved();

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

function button(label, className, onClick) {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function closeBanner() {
  document.getElementById('ck-banner')?.remove();
}

function decide(choice, categories) {
  saveChoice(choice, categories);
  closeBanner();
}

function buildSummary({ showCustomize, restoreFocusTo }) {
  const view = el('div', 'ck-view');
  const title = el('h2', 'ck-title', 'Sua privacidade importa');
  title.id = 'ck-title';
  const desc = el('p', 'ck-desc');
  desc.id = 'ck-desc';
  desc.append(
    'Usamos cookies essenciais para manter você conectado e o site funcionando. ' +
      'Não usamos cookies de publicidade. Saiba mais na ',
  );
  const link = el('a', '', 'Política de Cookies');
  link.href = POLICY_URL;
  desc.append(link, '.');

  const actions = el('div', 'ck-actions');
  actions.append(
    button('Aceitar todos', 'ck-btn ck-primary', () => decide('all', ALL)),
    button('Somente necessários', 'ck-btn', () => decide('essential', ESSENTIAL_ONLY)),
    button('Rejeitar', 'ck-btn', () => decide('essential', ESSENTIAL_ONLY)),
  );
  const more = button('Personalizar', 'ck-more', showCustomize);
  view.append(title, desc, actions, more);
  view.restoreFocusTo = restoreFocusTo ?? more;
  return view;
}

function buildCustomize({ initial, back }) {
  const view = el('div', 'ck-view');
  view.hidden = true;
  const title = el('h2', 'ck-title', 'Preferências de cookies');
  const desc = el(
    'p',
    'ck-desc',
    'Escolha quais categorias você permite. Os necessários não podem ser desativados.',
  );

  const state = { ...initial };
  const list = el('div', 'ck-list');
  for (const cat of CATEGORIES) {
    const box = el('div', 'ck-cat');
    const head = el('div', 'ck-cat-head');
    const label = el('label', 'ck-cat-name', cat.name);
    if (cat.locked) {
      head.append(label, el('span', 'ck-always', 'Sempre ativos'));
    } else {
      const wrap = el('span', 'ck-switch');
      const input = el('input');
      input.type = 'checkbox';
      input.setAttribute('role', 'switch');
      input.id = `ck-sw-${cat.id}`;
      input.checked = Boolean(state[cat.id]);
      input.addEventListener('change', () => {
        state[cat.id] = input.checked;
      });
      label.htmlFor = input.id;
      wrap.append(input, el('span'));
      head.append(label, wrap);
    }
    const p = el('p', '', cat.text);
    for (const [i, name] of (cat.cookies ?? []).entries()) {
      if (i) p.append(', ');
      p.append(el('code', '', name));
    }
    if (cat.cookies) p.append('.');
    box.append(head, p);
    if (cat.none) box.append(el('p', 'ck-none', cat.none));
    list.append(box);
  }

  const actions = el('div', 'ck-actions');
  actions.append(
    button('Salvar minhas escolhas', 'ck-btn ck-primary', () => decide('custom', state)),
    button('Aceitar todos', 'ck-btn', () => decide('all', ALL)),
    button('Rejeitar', 'ck-btn', () => decide('essential', ESSENTIAL_ONLY)),
  );
  const backBtn = button('Voltar', 'ck-more', back);
  view.append(title, desc, list, actions, backBtn);
  return view;
}

async function openBanner({ customize = false } = {}) {
  if (document.getElementById('ck-banner')) return;
  await loadStyles();

  const saved = readSaved();
  const initial = saved?.categories ?? ESSENTIAL_ONLY;

  const banner = el('div', 'ck-banner');
  banner.id = 'ck-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-labelledby', 'ck-title');
  banner.setAttribute('aria-describedby', 'ck-desc');

  let summary;
  const customizeView = buildCustomize({
    initial,
    back: () => {
      customizeView.hidden = true;
      summary.hidden = false;
      summary.querySelector('.ck-more')?.focus();
    },
  });
  summary = buildSummary({
    showCustomize: () => {
      summary.hidden = true;
      customizeView.hidden = false;
      customizeView.querySelector('input, button')?.focus();
    },
  });
  banner.append(summary, customizeView);
  document.body.append(banner);

  // Aberto de propósito pelo visitante (rodapé/política): vai direto ao painel e leva o foco para ele.
  if (customize) {
    summary.hidden = true;
    customizeView.hidden = false;
    customizeView.querySelector('input, button')?.focus();
    banner.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeBanner();
    });
  }
}

/** Acrescenta ao rodapé das páginas que já têm um: link da política e botão de preferências. */
function addFooterLinks() {
  for (const footer of document.querySelectorAll('footer, .afoot')) {
    if (footer.querySelector('[data-cookie-policy-link]')) continue;
    const link = el('a', 'ck-link', 'Política de Cookies');
    link.href = POLICY_URL;
    link.dataset.cookiePolicyLink = '';
    const prefs = el('button', 'ck-link', 'Preferências de cookies');
    prefs.type = 'button';
    prefs.dataset.cookieSettings = '';
    footer.append(' · ', link, ' · ', prefs);
  }
}

function init() {
  loadStyles(); // o botão do rodapé também usa esta folha de estilo
  addFooterLinks();
  // Botões "Gerenciar preferências de cookies" (rodapé e página da política).
  document.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-cookie-settings]')) {
      openBanner({ customize: true });
    }
  });
  if (!readSaved()) openBanner();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();