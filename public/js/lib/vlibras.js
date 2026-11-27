/**
 * VLibras (tradutor oficial gratuito para Libras do governo brasileiro).
 *
 * Antes: o plugin inteiro era baixado em TODAS as páginas, mesmo para quem nunca usa.
 * Agora: aparece um botão leve "Libras" e o plugin só é baixado quando a pessoa clica.
 * Quem já ativou uma vez continua com o carregamento automático nas próximas páginas.
 *
 * Documentação: https://vlibras.gov.br/doc/widget/installation/webpageintegration.html
 */
const SCRIPT_SRC = 'https://vlibras.gov.br/app/vlibras-plugin.js';
const ROOT_PATH = 'https://vlibras.gov.br/app';
const ATTR = 'data-estudai-vlibras';
const FLAG = 'estudai-vlibras';

function wasActivatedBefore() {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

function rememberActivation() {
  try {
    localStorage.setItem(FLAG, '1');
  } catch {
    /* ignore */
  }
}

function createMarkup() {
  if (document.querySelector(`[${ATTR}]`)) return;

  const root = document.createElement('div');
  root.setAttribute('vw', '');
  root.className = 'enabled';
  root.setAttribute(ATTR, '');

  const accessBtn = document.createElement('div');
  accessBtn.setAttribute('vw-access-button', '');
  accessBtn.className = 'active';

  const wrapper = document.createElement('div');
  wrapper.setAttribute('vw-plugin-wrapper', '');

  const topWrapper = document.createElement('div');
  topWrapper.className = 'vw-plugin-top-wrapper';

  wrapper.append(topWrapper);
  root.append(accessBtn, wrapper);
  document.body.append(root);
}

function loadPlugin(onReady, onFail) {
  if (window.VLibras?.Widget) {
    try {
      new window.VLibras.Widget(ROOT_PATH);
    } catch {
      /* já inicializado */
    }
    onReady?.();
    return;
  }
  if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return;

  const script = document.createElement('script');
  script.src = SCRIPT_SRC;
  script.async = true;
  script.onload = () => {
    try {
      if (window.VLibras?.Widget) new window.VLibras.Widget(ROOT_PATH);
    } catch {
      /* ignore */
    }
    onReady?.();
  };
  script.onerror = () => {
    script.remove();
    onFail?.();
  };
  document.head.append(script);
}

function injectPlaceholderStyle() {
  if (document.getElementById('vlibras-lazy-style')) return;
  const style = document.createElement('style');
  style.id = 'vlibras-lazy-style';
  style.textContent = `
    .vlibras-lazy{position:fixed;right:0;bottom:72px;z-index:50;display:flex;flex-direction:column;
      align-items:center;gap:2px;width:52px;padding:8px 4px;border:0;border-radius:12px 0 0 12px;
      background:#1f5ed8;color:#fff;font:700 10px/1 inherit;cursor:pointer;
      box-shadow:0 4px 14px rgba(0,0,0,.35)}
    .vlibras-lazy svg{width:24px;height:24px;fill:none;stroke:#fff;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .vlibras-lazy:focus-visible{outline:3px solid #ffc83d;outline-offset:2px}
    .vlibras-lazy[disabled]{opacity:.7;cursor:progress}
    body:has(.klyra-composer) .vlibras-lazy{bottom:110px}
  `;
  document.head.append(style);
}

function createPlaceholder() {
  if (document.querySelector('.vlibras-lazy')) return;
  injectPlaceholderStyle();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vlibras-lazy';
  btn.setAttribute('aria-label', 'Ativar o tradutor de Libras (VLibras)');
  btn.title = 'Tradutor de Libras (VLibras)';
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V6a1.5 1.5 0 013 0v4m0-1V4.5a1.5 1.5 0 013 0V10m0-.5V6a1.5 1.5 0 013 0v7c0 4-2.5 7-6.5 7S5 17 5 14v-2a1.5 1.5 0 012-1.4"/></svg><span>Libras</span>';

  btn.addEventListener('click', () => {
    btn.disabled = true;
    createMarkup();
    loadPlugin(
      () => {
        rememberActivation();
        btn.remove();
        // Abre o painel real do VLibras logo depois que ele terminar de montar.
        setTimeout(() => document.querySelector('[vw-access-button]')?.click(), 500);
      },
      () => {
        btn.disabled = false; // sem internet / bloqueado: deixa tentar de novo
      },
    );
  });

  document.body.append(btn);
}

function init() {
  if (wasActivatedBefore()) {
    createMarkup();
    const start = () => loadPlugin();
    if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 4000 });
    else setTimeout(start, 1500);
    return;
  }
  createPlaceholder();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
