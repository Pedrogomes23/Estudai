import { api, ApiError } from '../lib/api.js';
import { initSidebar } from '../lib/sidebar.js';
import { $ } from '../lib/dom.js';

let currentConversationId = null;
let remainingToday = null;
let isSending = false;
/** @type {{ name: string, text: string, source: 'file'|'material' } | null} */
let pendingAttachment = null;

const els = {
  list: $('klyra-list'),
  messages: $('klyra-messages'),
  empty: $('klyra-empty'),
  form: $('klyra-form'),
  input: $('klyra-input'),
  send: $('klyra-send'),
  meta: $('klyra-meta'),
  error: $('klyra-error'),
  btnNew: $('btn-new-chat'),
  btnStart: $('btn-start'),
  btnHistory: $('btn-history'),
  klyraSidebar: $('klyra-sidebar'),
  btnAttach: $('btn-attach'),
  fileInput: $('klyra-file'),
  btnMaterial: $('btn-material'),
  attachChip: $('klyra-attach-chip'),
  materialModal: $('klyra-material-modal'),
  materialList: $('klyra-material-list'),
  materialClose: $('klyra-material-close'),
  materialSearch: $('klyra-material-search'),
};

/** Cache da lista de materiais da plataforma (para busca local). */
let platformMaterials = [];


function showError(msg) {
  if (!els.error) return;
  els.error.textContent = msg || '';
  els.error.hidden = !msg;
}

function setComposerEnabled(enabled) {
  if (!els.input || !els.send) return;
  els.input.disabled = !enabled;
  els.send.disabled = !enabled || isSending;
  if (els.btnAttach) els.btnAttach.disabled = !enabled || isSending;
  if (els.btnMaterial) els.btnMaterial.disabled = !enabled || isSending;
  if (enabled) {
    requestAnimationFrame(() => els.input.focus());
  }
}

function updateMeta() {
  if (!els.meta) return;
  if (remainingToday == null) {
    els.meta.textContent = '';
    return;
  }
  els.meta.textContent =
    remainingToday > 0
      ? `${remainingToday} mensagens restantes hoje`
      : 'Limite diário atingido. Volte amanhã!';
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Converte markdown simples (estilo ChatGPT) em HTML seguro. */
function formatMarkdown(raw) {
  let text = escapeHtml(String(raw || ''));

  // blocos de código ```
  text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
    return `<pre class="md-code"><code>${code.trim()}</code></pre>`;
  });

  // código inline
  text = text.replace(/`([^`\n]+)`/g, '<code class="md-inline">$1</code>');

  // negrito **texto** ou __texto__
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // itálico *texto* (evita conflito com listas)
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

  // títulos
  text = text.replace(/^### (.+)$/gm, '<h4 class="md-h">$1</h4>');
  text = text.replace(/^## (.+)$/gm, '<h3 class="md-h">$1</h3>');
  text = text.replace(/^# (.+)$/gm, '<h3 class="md-h">$1</h3>');

  // listas numeradas e com bullet
  const lines = text.split('\n');
  const out = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      out.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      out.push('</ol>');
      inOl = false;
    }
  };

  for (const line of lines) {
    const ulMatch = line.match(/^[\s]*[-*•]\s+(.+)$/);
    const olMatch = line.match(/^[\s]*(\d+)[.)]\s+(.+)$/);

    if (ulMatch) {
      if (inOl) {
        out.push('</ol>');
        inOl = false;
      }
      if (!inUl) {
        out.push('<ul class="md-list">');
        inUl = true;
      }
      out.push(`<li>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      if (inUl) {
        out.push('</ul>');
        inUl = false;
      }
      if (!inOl) {
        out.push('<ol class="md-list">');
        inOl = true;
      }
      out.push(`<li>${olMatch[2]}</li>`);
    } else {
      closeLists();
      if (line.trim() === '') {
        out.push('<br>');
      } else if (/^<h[34]|^<pre/.test(line)) {
        out.push(line);
      } else {
        out.push(`<p class="md-p">${line}</p>`);
      }
    }
  }
  closeLists();

  return out.join('\n');
}

function renderBubble(role, content, meta) {
  const div = document.createElement('div');
  div.className = `msg-bubble ${role}`;
  const label = role === 'user' ? 'Você' : 'Klyra';
  const body =
    role === 'assistant' ? formatMarkdown(content) : escapeHtml(content).replace(/\n/g, '<br>');
  let extra = '';
  if (meta?.attachmentName) {
    extra = `<div class="msg-attach">📎 ${escapeHtml(meta.attachmentName)}</div>`;
  }
  div.innerHTML = `<span class="role-label">${label}</span>${extra}<div class="msg-body">${body}</div>`;
  return div;
}

function clearMessages() {
  if (!els.messages) return;
  els.messages.innerHTML = '';
  if (els.empty) {
    els.messages.appendChild(els.empty);
    els.empty.hidden = false;
  }
}

function hideEmpty() {
  if (els.empty) els.empty.hidden = true;
}

function updateAttachChip() {
  if (!els.attachChip) return;
  if (!pendingAttachment) {
    els.attachChip.hidden = true;
    els.attachChip.innerHTML = '';
    return;
  }
  els.attachChip.hidden = false;
  els.attachChip.innerHTML = `
    <span class="chip-name">📎 ${escapeHtml(pendingAttachment.name)}</span>
    <button type="button" class="chip-remove" aria-label="Remover arquivo">✕</button>
  `;
  els.attachChip.querySelector('.chip-remove')?.addEventListener('click', () => {
    pendingAttachment = null;
    if (els.fileInput) els.fileInput.value = '';
    updateAttachChip();
  });
}

async function loadConversations() {
  try {
    const data = await api.ai.listConversations();
    renderConversationList(data.items || []);
    return data.items || [];
  } catch (err) {
    console.error(err);
    return [];
  }
}

function renderConversationList(items) {
  if (!els.list) return;
  els.list.innerHTML = '';
  if (!items.length) {
    els.list.innerHTML =
      '<p style="color:var(--mut);font-size:13px;padding:12px;text-align:center">Nenhuma conversa ainda</p>';
    return;
  }

  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'klyra-item' + (item.id === currentConversationId ? ' active' : '');
    el.dataset.id = item.id;
    el.innerHTML = `
      <span class="title">${escapeHtml(item.title || 'Nova conversa')}</span>
      <button class="del" type="button" title="Excluir" aria-label="Excluir conversa">✕</button>
    `;
    el.addEventListener('click', (e) => {
      if (e.target.closest('.del')) return;
      openConversation(item.id);
    });
    el.querySelector('.del').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(item.id);
    });
    els.list.appendChild(el);
  }
}

async function openConversation(id) {
  currentConversationId = id;
  showError('');
  setComposerEnabled(true);
  pendingAttachment = null;
  updateAttachChip();

  if (els.list) {
    els.list.querySelectorAll('.klyra-item').forEach((el) => {
      el.classList.toggle('active', Number(el.dataset.id) === Number(id));
    });
  }

  if (window.matchMedia('(max-width: 860px)').matches) {
    els.klyraSidebar?.classList.remove('open');
  }

  try {
    const data = await api.ai.getConversation(id);
    els.messages.innerHTML = '';
    hideEmpty();

    for (const msg of data.messages || []) {
      els.messages.appendChild(renderBubble(msg.role, msg.content));
    }
    scrollToBottom();
  } catch (err) {
    showError(err.message || 'Não foi possível carregar a conversa.');
  }
}

async function ensureConversation() {
  if (currentConversationId) return currentConversationId;
  const data = await api.ai.createConversation();
  currentConversationId = data.item.id;
  await loadConversations();
  return currentConversationId;
}

async function createNewConversation() {
  try {
    showError('');
    const data = await api.ai.createConversation();
    currentConversationId = data.item.id;
    await loadConversations();
    els.messages.innerHTML = '';
    hideEmpty();
    pendingAttachment = null;
    updateAttachChip();
    setComposerEnabled(true);
    els.input.value = '';
    autoResize();
    els.input.focus();
  } catch (err) {
    showError(err.message || 'Não foi possível criar a conversa.');
  }
}

async function deleteConversation(id) {
  if (!confirm('Excluir esta conversa?')) return;
  try {
    await api.ai.deleteConversation(id);
    if (currentConversationId === id) {
      currentConversationId = null;
      clearMessages();
      setComposerEnabled(true);
    }
    await loadConversations();
  } catch (err) {
    showError(err.message || 'Não foi possível excluir.');
  }
}

async function readFileAsText(file) {
  const name = file.name || 'arquivo';
  const lower = name.toLowerCase();

  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.csv')) {
    return await file.text();
  }

  // PDF / outros: envia para o backend extrair
  const form = new FormData();
  form.append('file', file);
  const data = await api.ai.extractText(form);
  return data.text || '';
}

async function onFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const maxMb = 8;
  if (file.size > maxMb * 1024 * 1024) {
    showError(`Arquivo muito grande. Máximo ${maxMb} MB.`);
    els.fileInput.value = '';
    return;
  }

  try {
    showError('');
    const text = await readFileAsText(file);
    if (!text || !text.trim()) {
      showError('Não consegui ler texto deste arquivo. Tente PDF, TXT ou MD.');
      els.fileInput.value = '';
      return;
    }
    // limita contexto enviado à IA
    const clipped = text.slice(0, 60000);
    pendingAttachment = { name: file.name, text: clipped, source: 'file' };
    updateAttachChip();
  } catch (err) {
    showError(err.message || 'Falha ao ler o arquivo.');
    els.fileInput.value = '';
  }
}

function renderMaterialItems(items) {
  if (!els.materialList) return;
  els.materialList.innerHTML = '';
  if (!items.length) {
    els.materialList.innerHTML =
      '<p class="mut" style="padding:16px;text-align:center">Nenhum material encontrado.</p>';
    return;
  }
  for (const item of items) {
    const meta = [item.category, item.author].filter(Boolean).join(' · ');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'material-pick-item';
    btn.innerHTML = `
      <strong>${escapeHtml(item.title || 'Sem título')}</strong>
      <span>${escapeHtml(meta || item.discipline || item.area || '')}</span>
    `;
    btn.addEventListener('click', () => selectMaterial(item));
    els.materialList.appendChild(btn);
  }
}

function filterPlatformMaterials(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return platformMaterials;
  return platformMaterials.filter((item) => {
    const hay = [item.title, item.author, item.category, item.discipline, item.area, item.description]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

async function openMaterialPicker() {
  if (!els.materialModal || !els.materialList) return;
  els.materialModal.hidden = false;
  if (els.materialSearch) {
    els.materialSearch.value = '';
    requestAnimationFrame(() => els.materialSearch.focus());
  }
  els.materialList.innerHTML = '<p class="mut" style="padding:16px;text-align:center">Carregando materiais…</p>';

  try {
    // Lista materiais públicos da plataforma (não só os seus)
    const data = await api.materials.list({ sort: 'recent' });
    platformMaterials = data.items || [];
    if (!platformMaterials.length) {
      els.materialList.innerHTML =
        '<p class="mut" style="padding:16px;text-align:center">Ainda não há materiais na plataforma.</p>';
      return;
    }
    renderMaterialItems(platformMaterials);
  } catch (err) {
    els.materialList.innerHTML = `<p style="color:var(--err);padding:16px;text-align:center">${escapeHtml(err.message || 'Erro ao listar')}</p>`;
  }
}

async function selectMaterial(item) {
  try {
    showError('');
    els.materialList.innerHTML = '<p class="mut" style="padding:12px">Extraindo texto…</p>';
    const data = await api.ai.extractFromMaterial(item.id);
    if (!data?.text?.trim()) {
      showError('Não consegui extrair texto deste material.');
      closeMaterialModal();
      return;
    }
    pendingAttachment = {
      name: item.title || `material-${item.id}`,
      text: String(data.text).slice(0, 60000),
      source: 'material',
    };
    updateAttachChip();
    closeMaterialModal();
  } catch (err) {
    showError(err.message || 'Falha ao usar o material.');
    closeMaterialModal();
  }
}

function closeMaterialModal() {
  if (els.materialModal) els.materialModal.hidden = true;
}

async function sendMessage(e) {
  e.preventDefault();
  if (isSending) return;

  const content = (els.input?.value || '').trim();
  if (!content && !pendingAttachment) return;

  const userDisplay =
    content ||
    (pendingAttachment ? `Analise o arquivo: ${pendingAttachment.name}` : '');

  isSending = true;
  setComposerEnabled(false);
  showError('');
  hideEmpty();

  els.messages.appendChild(
    renderBubble('user', userDisplay, {
      attachmentName: pendingAttachment?.name,
    }),
  );

  const attachmentToSend = pendingAttachment;
  pendingAttachment = null;
  updateAttachChip();
  if (els.fileInput) els.fileInput.value = '';

  els.input.value = '';
  autoResize();
  scrollToBottom();

  const optimisticTitle = makeClientTitle(userDisplay);
  if (currentConversationId) {
    updateListTitle(currentConversationId, optimisticTitle);
  }

  const typing = document.createElement('div');
  typing.className = 'klyra-typing';
  typing.id = 'klyra-typing';
  typing.textContent = 'Klyra está pensando…';
  els.messages.appendChild(typing);
  scrollToBottom();

  try {
    await ensureConversation();
    updateListTitle(currentConversationId, optimisticTitle);

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        const err = new Error('A Klyra demorou demais para responder. Tente de novo.');
        err.code = 'AI_TIMEOUT';
        reject(err);
      }, 60000);
    });

    const payload = {
      content: content || userDisplay,
    };
    if (attachmentToSend?.text) {
      payload.attachmentName = attachmentToSend.name;
      payload.attachmentText = attachmentToSend.text;
    }

    const data = await Promise.race([
      api.ai.sendMessage(currentConversationId, payload),
      timeoutPromise,
    ]);

    typing.remove();
    els.messages.appendChild(renderBubble('assistant', data.assistantMessage.content));
    remainingToday = data.remainingToday;
    updateMeta();
    if (data.title) updateListTitle(currentConversationId, data.title);
    await loadConversations();
    scrollToBottom();
  } catch (err) {
    typing.remove();
    const msg =
      err instanceof ApiError
        ? err.message
        : err?.code === 'AI_TIMEOUT'
          ? err.message
          : 'Não foi possível obter resposta da Klyra. Tente de novo.';
    showError(msg);
    try {
      await loadConversations();
    } catch {
      /* ignore */
    }
  } finally {
    isSending = false;
    setComposerEnabled(true);
  }
}

function makeClientTitle(text) {
  const oneLine = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!oneLine) return 'Nova conversa';
  if (oneLine.length <= 42) return oneLine;
  const cut = oneLine.slice(0, 42);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > 20 ? cut.slice(0, lastSpace) : cut;
  return `${base}…`;
}

function updateListTitle(id, title) {
  if (!els.list || !title) return;
  const item = els.list.querySelector(`.klyra-item[data-id="${id}"]`);
  if (!item) return;
  const span = item.querySelector('.title');
  if (span) span.textContent = title;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    if (els.messages) els.messages.scrollTop = els.messages.scrollHeight;
  });
}

function autoResize() {
  if (!els.input) return;
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 160) + 'px';
}

async function init() {
  let user;
  try {
    user = await api.auth.me();
  } catch {
    location.href = 'login.html';
    return;
  }

  initSidebar({ active: 'klyra', user, isAdmin: !!user.is_admin });

  try {
    const limits = await api.ai.limits();
    remainingToday = limits.dailyMessageLimit;
    updateMeta();
  } catch {
    // ignora
  }

  setComposerEnabled(true);

  const items = await loadConversations();

  if (items.length > 0) {
    await openConversation(items[0].id);
  }

  if (els.form) {
    els.form.addEventListener('submit', sendMessage);
  }

  if (els.input) {
    els.input.addEventListener('input', autoResize);
    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        els.form?.requestSubmit();
      }
    });
  }

  els.btnNew?.addEventListener('click', () => {
    createNewConversation();
    els.klyraSidebar?.classList.remove('open');
  });

  els.btnStart?.addEventListener('click', () => {
    hideEmpty();
    setComposerEnabled(true);
    els.input?.focus();
  });

  els.btnHistory?.addEventListener('click', () => {
    els.klyraSidebar?.classList.toggle('open');
  });

  els.btnAttach?.addEventListener('click', () => els.fileInput?.click());
  els.fileInput?.addEventListener('change', onFileSelected);
  els.btnMaterial?.addEventListener('click', openMaterialPicker);
  els.materialClose?.addEventListener('click', closeMaterialModal);
  els.materialModal?.addEventListener('click', (e) => {
    if (e.target === els.materialModal) closeMaterialModal();
  });
  els.materialSearch?.addEventListener('input', () => {
    renderMaterialItems(filterPlatformMaterials(els.materialSearch.value));
  });
}

init();
