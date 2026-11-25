/** Utilidades de DOM compartilhadas pelas páginas. */

export const $ = (id) => document.getElementById(id);

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa texto antes de inserir em innerHTML (evita XSS). */
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

export const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';
export const ICON_USERS =
  '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>';

/**
 * Liga as abas (botões com data-tab="chave"). Cada chave corresponde a
 * um botão #t-<chave> e a um painel #p-<chave>.
 */
export function initTabs(keys, { onChange } = {}) {
  function setTab(active) {
    for (const key of keys) {
      $(`p-${key}`).hidden = key !== active;
      $(`t-${key}`).setAttribute('aria-selected', String(key === active));
    }
    onChange?.(active);
  }
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-tab]');
    if (trigger && keys.includes(trigger.dataset.tab)) setTab(trigger.dataset.tab);
  });
  return setTab;
}

/** Executa `fn` só depois de `ms` sem novas chamadas (usado nas buscas). */
export function debounce(fn, ms = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
