/**
 * Barra de acessibilidade própria do Estudaí! (gratuita, sem serviços pagos).
 * Módulo independente: injeta CSS e UI, salva preferências em localStorage.
 *
 * Opções: tamanho do texto, alto contraste, destacar links, espaçamento,
 * fonte legível, pausar animações e restaurar padrão.
 */
const KEY = 'estudai_a11y';
const STYLE_URL = '/css/accessibility.css';
const PAGE_URL = '/acessibilidade';

const DEFAULTS = {
  text: 0, // 0=100%, 1=112.5%, 2=125%, 3=150%, 4=200%
  contrast: false,
  links: false,
  spacing: false,
  readable: false,
  reduceMotion: false,
};

const TEXT_CLASSES = ['', 'a11y-text-lg', 'a11y-text-xl', 'a11y-text-xxl', 'a11y-text-max'];

function readPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
    return {
      text: Math.min(4, Math.max(0, Number(raw.text) || 0)),
      contrast: Boolean(raw.contrast),
      links: Boolean(raw.links),
      spacing: Boolean(raw.spacing),
      readable: Boolean(raw.readable),
      reduceMotion: Boolean(raw.reduceMotion),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* private mode */
  }
}

function applyPrefs(prefs) {
  const html = document.documentElement;
  TEXT_CLASSES.forEach((c) => c && html.classList.remove(c));
  if (prefs.text > 0 && TEXT_CLASSES[prefs.text]) {
    html.classList.add(TEXT_CLASSES[prefs.text]);
  }
  html.classList.toggle('a11y-contrast', prefs.contrast);
  html.classList.toggle('a11y-links', prefs.links);
  html.classList.toggle('a11y-spacing', prefs.spacing);
  html.classList.toggle('a11y-readable', prefs.readable);
  html.classList.toggle('a11y-reduce-motion', prefs.reduceMotion);
}

// Aplicar o mais cedo possível (evita “piscada”)
const early = readPrefs();
if (Object.keys(DEFAULTS).some((k) => early[k] !== DEFAULTS[k])) {
  applyPrefs(early);
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
  if (text != null) node.textContent = text;
  return node;
}

function iconPerson() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<circle cx="12" cy="7" r="3"/><path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M3 12h3M18 12h3M12 3v2"/>';
  return svg;
}

let panel = null;
let trigger = null;
let prefs = readPrefs();

function closePanel() {
  if (!panel) return;
  panel.hidden = true;
  document.removeEventListener('keydown', onPanelKey);
  trigger?.focus();
}

function onPanelKey(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closePanel();
    return;
  }
  if (event.key !== 'Tab' || !panel) return;
  const focusables = panel.querySelectorAll(
    'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function updatePressed() {
  if (!panel) return;
  panel.querySelectorAll('[data-a11y]').forEach((btn) => {
    const key = btn.dataset.a11y;
    if (key === 'text-up' || key === 'text-down' || key === 'reset') return;
    btn.setAttribute('aria-pressed', String(Boolean(prefs[key])));
  });
  const label = panel.querySelector('[data-a11y-text-label]');
  if (label) {
    const pct = [100, 112, 125, 150, 200][prefs.text] || 100;
    label.textContent = `${pct}%`;
  }
}

function setPref(key, value) {
  prefs = { ...prefs, [key]: value };
  applyPrefs(prefs);
  savePrefs(prefs);
  updatePressed();
}

function buildPanel() {
  const dialog = el('div', 'a11y-panel');
  dialog.id = 'a11y-panel';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'a11y-title');
  dialog.setAttribute('aria-describedby', 'a11y-desc');
  dialog.hidden = true;

  const close = el('button', 'a11y-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Fechar painel de acessibilidade');
  close.addEventListener('click', closePanel);

  const title = el('h2', null, 'Acessibilidade');
  title.id = 'a11y-title';

  const desc = el('p', 'a11y-desc', 'Ajuste a leitura e o contraste desta página. As opções ficam salvas neste navegador.');
  desc.id = 'a11y-desc';

  // Texto
  const textGroup = el('div', 'a11y-group');
  const textLabel = el('div', 'a11y-label', 'Tamanho do texto');
  const textRow = el('div', 'a11y-row');
  const textDown = el('button', 'a11y-btn', 'A−');
  textDown.type = 'button';
  textDown.dataset.a11y = 'text-down';
  textDown.setAttribute('aria-label', 'Diminuir texto');
  textDown.addEventListener('click', () => setPref('text', Math.max(0, prefs.text - 1)));
  const textVal = el('span', null, '100%');
  textVal.dataset.a11yTextLabel = '';
  textVal.setAttribute('aria-live', 'polite');
  const textUp = el('button', 'a11y-btn', 'A+');
  textUp.type = 'button';
  textUp.dataset.a11y = 'text-up';
  textUp.setAttribute('aria-label', 'Aumentar texto');
  textUp.addEventListener('click', () => setPref('text', Math.min(4, prefs.text + 1)));
  textRow.append(textDown, textVal, textUp);
  textGroup.append(textLabel, textRow);

  function toggleBtn(key, label) {
    const btn = el('button', 'a11y-btn', label);
    btn.type = 'button';
    btn.dataset.a11y = key;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => setPref(key, !prefs[key]));
    return btn;
  }

  const opts = el('div', 'a11y-group');
  opts.append(
    el('div', 'a11y-label', 'Opções'),
    toggleBtn('contrast', 'Alto contraste'),
    toggleBtn('links', 'Destacar links'),
    toggleBtn('spacing', 'Espaçamento maior'),
    toggleBtn('readable', 'Fonte legível'),
    toggleBtn('reduceMotion', 'Pausar animações'),
  );

  const reset = el('button', 'a11y-btn a11y-reset', 'Restaurar padrão');
  reset.type = 'button';
  reset.dataset.a11y = 'reset';
  reset.addEventListener('click', () => {
    prefs = { ...DEFAULTS };
    applyPrefs(prefs);
    savePrefs(prefs);
    updatePressed();
  });

  const more = el('a', 'a11y-link', 'Saiba mais sobre acessibilidade');
  more.href = PAGE_URL;

  dialog.append(close, title, desc, textGroup, opts, reset, more);
  document.body.append(dialog);
  return dialog;
}

function openPanel() {
  if (!panel) panel = buildPanel();
  updatePressed();
  panel.hidden = false;
  document.addEventListener('keydown', onPanelKey);
  panel.querySelector('button, a')?.focus();
}

function bindTrigger(btn) {
  if (!btn || btn.dataset.a11yBound) return;
  btn.dataset.a11yBound = '1';
  btn.addEventListener('click', () => {
    if (panel && !panel.hidden) closePanel();
    else openPanel();
  });
  trigger = btn;
}

async function init() {
  await loadStyles();

  // Preferências já aplicadas no topo do módulo; reaplicar após possíveis mudanças de tema
  applyPrefs(prefs);

  function tryBindOrFallback() {
    const existing = document.getElementById('a11y-trigger');
    if (existing) {
      // Remove flutuante residual se a sidebar já criou o botão
      document.querySelectorAll('body > .a11y-trigger:not(.a11y-side-btn)').forEach((n) => n.remove());
      bindTrigger(existing);
      return true;
    }
    return false;
  }

  if (!tryBindOrFallback()) {
    // Sidebar ainda não montou: observa o DOM e, se após um tempo não aparecer, cria flutuante
    const mo = new MutationObserver(() => {
      if (tryBindOrFallback()) mo.disconnect();
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // Timeout de segurança: se em 2s não houver botão da sidebar, usa flutuante
    setTimeout(() => {
      if (tryBindOrFallback()) {
        mo.disconnect();
        return;
      }
      mo.disconnect();
      if (document.getElementById('a11y-trigger')) return;
      trigger = el('button', 'a11y-trigger');
      trigger.id = 'a11y-trigger';
      trigger.type = 'button';
      trigger.setAttribute('aria-label', 'Abrir opções de acessibilidade');
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-controls', 'a11y-panel');
      trigger.append(iconPerson());
      bindTrigger(trigger);
      document.body.append(trigger);
    }, 2000);
  }

  // Continua observando a sidebar para re-bind após rebuild (admin / setSidebarUser)
  const watchSidebar = () => {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const mo2 = new MutationObserver(() => {
      const btn = document.getElementById('a11y-trigger');
      if (btn) bindTrigger(btn);
    });
    mo2.observe(sidebar, { childList: true, subtree: true });
  };
  watchSidebar();
  // Sidebar pode ser criada depois
  const bodyMo = new MutationObserver(() => {
    if (document.getElementById('sidebar')) {
      watchSidebar();
      bodyMo.disconnect();
    }
  });
  bodyMo.observe(document.body, { childList: true });

  // Link no rodapé (como o cookie-consent)
  for (const footer of document.querySelectorAll('footer, .afoot')) {
    if (footer.querySelector('[data-a11y-page-link]')) continue;
    const link = el('a', null, 'Acessibilidade');
    link.href = PAGE_URL;
    link.dataset.a11yPageLink = '';
    footer.append(' · ', link);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
