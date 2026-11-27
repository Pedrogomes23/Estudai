/**
 * VLibras (tradutor oficial gratuito para Libras do governo brasileiro).
 * Cria o markup oficial do widget e carrega o plugin quando a página já terminou de
 * carregar e o navegador está ocioso, para não atrapalhar a abertura das telas.
 *
 * Documentação: https://vlibras.gov.br/doc/widget/installation/webpageintegration.html
 */
const SCRIPT_SRC = 'https://vlibras.gov.br/app/vlibras-plugin.js';
const ROOT_PATH = 'https://vlibras.gov.br/app';
const ATTR = 'data-estudai-vlibras';

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

function loadPlugin() {
  if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return;
  if (window.VLibras?.Widget) {
    try {
      new window.VLibras.Widget(ROOT_PATH);
    } catch {
      /* já inicializado */
    }
    return;
  }

  const script = document.createElement('script');
  script.src = SCRIPT_SRC;
  script.async = true;
  script.onload = () => {
    try {
      if (window.VLibras?.Widget) {
        new window.VLibras.Widget(ROOT_PATH);
      }
    } catch {
      /* ignore */
    }
  };
  document.head.append(script);
}

function init() {
  createMarkup();

  // Espera a página terminar de carregar (imagens, estilos, dados) antes de baixar o plugin.
  const start = () => {
    if ('requestIdleCallback' in window) requestIdleCallback(loadPlugin, { timeout: 3000 });
    else setTimeout(loadPlugin, 500);
  };

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
