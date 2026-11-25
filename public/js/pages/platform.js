import { ApiError, api } from '../lib/api.js';
// Garante autenticação: visitantes vão para o login
api.auth.me().catch(() => location.replace('login.html'));

import { $, debounce, escapeHtml, ICON_DOWNLOAD, ICON_USERS, initTabs } from '../lib/dom.js';
import { initSidebar, setSidebarUser } from '../lib/sidebar.js';

// Importando o Supabase Client para o upload de arquivos do chat
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const supabaseUrl = 'https://abozwskrdzmxljnjlaai.supabase.co'; 
const supabaseKey = 'sb_publishable_e3uyPCYDct4Xd_Qc7szWsw_yC73UEQq'; 
const supabase = createClient(supabaseUrl, supabaseKey);

const state = { me: null, materials: [], totalMaterials: 0, communities: [], room: null };
let setTab;

/* ---------- Utilidades ---------- */

const formatSize = (n) =>
  n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;
const MAX_UPLOAD = 25 * 1024 * 1024;
const MAX_CHAT_UPLOAD = 50 * 1024 * 1024; // 50MB para o chat

let toastTimer;
function say(text) {
  const box = $('msg');
  box.textContent = text;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), 3200);
}

/** Sessão expirada volta para o login; qualquer outro erro vira aviso na tela. */
function handleError(err, fallback) {
  if (err instanceof ApiError && err.status === 401) return location.replace('login.html');
  say(err instanceof ApiError ? err.message : fallback);
}

/** Ignora respostas antigas quando o usuário digita mais rápido que a rede. */
function latest() {
  let current = 0;
  return (promise) => {
    const id = ++current;
    return promise.then((value) => (id === current ? value : null));
  };
}

/* ---------- Apostilas ---------- */

const onlyLatestMaterials = latest();

async function loadMaterials() {
  try {
    const data = await onlyLatestMaterials(
      api.materials.list({
        q: $('q').value.trim(),
        category: $('cat').value,
        area: $('area')?.value || '',
        sort: $('sort-mat')?.value || 'recent',
        mine: $('scope-mat')?.value === 'mine' ? '1' : '',
      }),
    );
    if (!data) return;
    state.materials = data.items;
    state.totalMaterials = data.total;
    renderMaterials();
  } catch (err) {
    handleError(err, 'Não foi possível carregar os materiais.');
  }
}

function renderMaterials() {
  const { materials, totalMaterials } = state;
  $('gm').innerHTML = materials.length
    ? materials
        .map((x) => {
          const theme = [x.area, x.discipline].filter(Boolean).join(' · ');
          return (
            `<div class="card"><span class="tag">${escapeHtml(x.category)}</span>` +
            `<span class="tag" style="background:var(--line);color:var(--fg);margin-left:6px">${escapeHtml(x.area || 'Outros')}</span>` +
            `<h3>${escapeHtml(x.title)}</h3>` +
            `<small>${escapeHtml(theme)}<br>Enviado por ${escapeHtml(x.author)} · ${formatSize(x.fileSize)}</small>` +
            (x.description ? `<p class="d">${escapeHtml(x.description)}</p>` : '') +
            `<div class="foot"><span>${ICON_DOWNLOAD} ${x.downloads} downloads</span><span class="acts">` +
            ((x.canDelete || x.mine || state.me?.isAdmin)
              ? `<button class="lnk" data-act="delete-material" data-id="${x.id}">Excluir</button>`
              : '') +
            `<button class="btn p sm" data-act="download" data-id="${x.id}">Baixar</button></span></div></div>`
          );
        })
        .join('')
    : `<p class="empty">${
        totalMaterials
          ? 'Nenhum material encontrado com esses filtros.'
          : 'Ainda não há materiais. Seja o primeiro a publicar um.'
      }</p>`;
}

function openMaterialModal() {
  closeModals();
  $('mm').classList.add('s');
  $('me').textContent = '';
  $('nt').focus();
}

async function addMaterial(event) {
  event.preventDefault();
  const form = event.target;
  const file = $('nf').files[0];
  const error = $('me');
  error.textContent = '';
  if (!file) return void (error.textContent = 'Escolha o arquivo do material.');
  if (file.size > MAX_UPLOAD) {
    return void (error.textContent = `O arquivo tem ${formatSize(file.size)}. O limite é 25 MB.`);
  }

  const data = new FormData();
  if (!$('na').value) {
    return void (error.textContent = 'Escolha a área em que o material se encaixa.');
  }
  data.set('title', $('nt').value.trim());
  data.set('area', $('na').value);
  data.set('discipline', $('nd').value.trim());
  data.set('category', $('nc').value);
  data.set('description', $('ns').value.trim());
  data.set('file', file);

  const button = $('mb');
  button.disabled = true;
  button.textContent = 'Publicando...';
  try {
    await api.materials.create(data);
    form.reset();
    $('q').value = '';
    $('cat').value = '';
    closeModals();
    await loadMaterials();
    say('Material publicado.');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return location.replace('login.html');
    error.textContent =
      err instanceof ApiError ? err.message : 'Não foi possível salvar o arquivo. Tente de novo.';
  } finally {
    button.disabled = false;
    button.textContent = 'Publicar';
  }
}

async function downloadMaterial(id) {
  const item = state.materials.find((x) => x.id === id);
  if (!item) return;
  try {
    const blob = await api.materials.download(id);
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: item.fileName });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    await loadMaterials(); // atualiza o contador de downloads
  } catch (err) {
    handleError(err, 'Não foi possível baixar o arquivo.');
  }
}

async function deleteMaterial(id) {
  if (!confirm('Excluir esta apostila? Essa ação não pode ser desfeita.')) return;
  try {
    await api.materials.remove(id);
    await loadMaterials();
    say('Apostila excluída.');
  } catch (err) {
    handleError(err, 'Não foi possível excluir a apostila.');
  }
}

/* ---------- Comunidades ---------- */

const onlyLatestCommunities = latest();

async function loadCommunities() {
  try {
    const scope = $('fc')?.value || '';
    const items = await onlyLatestCommunities(
      api.communities.list({
        q: $('qc').value.trim(),
        joined: scope === 'joined' ? '1' : '',
        owned: scope === 'owned' ? '1' : '',
        sort: $('sort-com')?.value || 'default',
      }),
    );
    if (!items) return;
    state.communities = items;
    renderCommunities();
  } catch (err) {
    handleError(err, 'Não foi possível carregar as comunidades.');
  }
}

function renderCommunities() {
  const { communities } = state;
  $('gc').innerHTML = communities.length
    ? communities
        .map(
          (x) =>
            `<div class="card"><h3>${escapeHtml(x.name)}</h3><div class="mem">${ICON_USERS} ${x.members}${x.members === 1 ? ' membro' : ' membros'}</div>` +
            `<p class="d">${escapeHtml(x.description)}</p><div class="foot"><span>` +
            (x.mine || state.me?.isAdmin
              ? `<button class="lnk" data-act="delete-community" data-id="${x.id}">Excluir</button>`
              : '') +
            `</span><span class="acts">` +
            (x.joined
              ? `<button class="btn p sm" data-act="open-room" data-id="${x.id}">Abrir chat</button>`
              : '') +
            `<button class="btn sm${x.joined ? ' on' : ''}" aria-pressed="${x.joined}" data-act="toggle-community" data-id="${x.id}">` +
            `${x.joined ? 'Participando · Sair' : 'Participar'}</button></span></div></div>`,
        )
        .join('')
    : `<p class="empty">${
        $('fc').value
          ? 'Você ainda não participa de nenhuma comunidade.'
          : 'Nenhuma comunidade encontrada. Crie a primeira sobre esse assunto.'
      }</p>`;
}

async function toggleCommunity(id) {
  const item = state.communities.find((x) => x.id === id);
  if (!item) return;
  try {
    if (item.joined) {
      await api.communities.leave(id);
      say(`Você saiu de ${item.name}.`);
      await loadCommunities();
    } else {
      await api.communities.join(id);
      say(`Você entrou em ${item.name}.`);
      openRoom(id); // entrou: já abre o chat
    }
  } catch (err) {
    handleError(err, 'Não foi possível atualizar sua participação.');
  }
}

function openCommunityModal() {
  closeModals();
  $('mc').classList.add('s');
  $('ce').textContent = '';
  $('cn').focus();
}

async function addCommunity(event) {
  event.preventDefault();
  const name = $('cn').value.trim();
  const description = $('cd').value.trim();
  if (!name || !description) return void ($('ce').textContent = 'Preencha o nome e a descrição.');
  try {
    await api.communities.create({ name, description });
    event.target.reset();
    $('qc').value = '';
    $('fc').value = '';
    closeModals();
    await loadCommunities();
    say('Comunidade criada. Você já é membro.');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return location.replace('login.html');
    $('ce').textContent = err instanceof ApiError ? err.message : 'Não foi possível criar a comunidade.';
  }
}

async function deleteCommunity(id) {
  if (!confirm('Excluir esta comunidade para todos os membros?')) return;
  try {
    await api.communities.remove(id);
    await loadCommunities();
    say('Comunidade excluída.');
  } catch (err) {
    handleError(err, 'Não foi possível excluir a comunidade.');
  }
}

/* ---------- Sala da comunidade: chat e participantes ---------- */

const POLL_MS = 3000;
const initials = (name) => (name.trim()[0] || '?').toUpperCase();

function formatTime(iso) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${time}`;
}

/** A URL define a tela: #comunidade-12 abre a sala; o resto mostra as abas. */
function route() {
  const match = /^#comunidade-(\d+)$/.exec(location.hash);
  if (match) return void showRoom(Number(match[1]));
  stopRoom();
  $('v-room').hidden = true;
  $('v-main').hidden = false;
  $('page-head').hidden = false;
  setTab(location.hash === '#comunidades' ? 'com' : 'mat');
  if (location.hash === '#comunidades') loadCommunities();
}

function openRoom(id) {
  location.hash = `comunidade-${id}`;
}

function closeRoom() {
  location.hash = 'comunidades';
}

function stopRoom() {
  if (state.room) clearInterval(state.room.timer);
  state.room = null;
}

async function showRoom(id) {
  stopRoom();
  let community;
  try {
    community = await api.communities.get(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) say('Essa comunidade não existe mais.');
    else handleError(err, 'Não foi possível abrir a comunidade.');
    return closeRoom();
  }
  if (!community.joined) {
    say('Entre na comunidade para ver o chat e os participantes.');
    return closeRoom();
  }

  state.room = { id, signature: '', timer: null, ticks: 0 };
  $('v-main').hidden = true;
  $('page-head').hidden = true;
  $('v-room').hidden = false;
  $('room-name').textContent = community.name;
  $('room-desc').textContent = community.description;
  $('room-msgs').innerHTML = '';
  $('room-members').innerHTML = '';
  $('room-count').textContent = '';
  $('chat-err').textContent = '';
  $('chat-input').value = '';
  window.scrollTo(0, 0);

  await refreshRoom(true);
  if (state.room?.id !== id) return;
  $('chat-input').focus();
  state.room.timer = setInterval(() => {
    if (document.hidden) return;
    refreshRoom(false);
  }, POLL_MS);
}

/** Busca mensagens (a cada ciclo) e participantes (a cada 3 ciclos). */
async function refreshRoom(first) {
  const room = state.room;
  if (!room) return;
  try {
    const wantMembers = first || room.ticks++ % 3 === 0;
    const [messages, members] = await Promise.all([
      api.communities.messages(room.id),
      wantMembers ? api.communities.members(room.id) : null,
    ]);
    if (state.room !== room) return; // trocou de tela enquanto carregava
    renderMessages(messages, first);
    if (members) renderMembers(members);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      say('Você não tem mais acesso a esta comunidade.');
      return closeRoom();
    }
    if (first) handleError(err, 'Não foi possível carregar o chat.');
  }
}

function renderMessages(messages, forceScroll) {
  const room = state.room;
  const signature = messages.map((m) => m.id).join(',');
  if (signature === room.signature) return;
  room.signature = signature;

  const box = $('room-msgs');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  
  box.innerHTML = messages.length
    ? messages
        .map((m) => {
          // Lógica para renderizar o arquivo caso exista na mensagem
          let attachmentHtml = '';
          if (m.attachmentUrl) {
            // Se for imagem, mostra a imagem
            if (m.attachmentType && m.attachmentType.startsWith('image/')) {
              attachmentHtml = `<div style="margin-top:8px;"><a href="${m.attachmentUrl}" target="_blank"><img src="${m.attachmentUrl}" alt="Anexo" style="max-width:100%;max-height:200px;border-radius:8px;"></a></div>`;
            } else {
              // Se for PDF/Doc, mostra um botão/card para baixar
              attachmentHtml = `<div style="margin-top:8px;"><a href="${m.attachmentUrl}" target="_blank" class="btn o sm" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;">📄 Baixar Anexo</a></div>`;
            }
          }

          return `<div class="bubble${m.mine ? ' me' : ''}">` +
            `<div class="who"><b>${m.mine ? 'Você' : escapeHtml(m.author.name)}</b>` +
            `<time datetime="${m.createdAt}">${formatTime(m.createdAt)}</time>` +
            (m.canDelete
              ? `<button class="lnk" data-act="delete-message" data-id="${m.id}">Excluir</button>`
              : '') +
            `</div>` +
            `<p class="txt">${escapeHtml(m.body)}</p>` +
            attachmentHtml +
            `</div>`;
        })
        .join('')
    : '<p class="empty">Ninguém escreveu ainda. Comece a conversa!</p>';
    
  if (forceScroll || nearBottom) box.scrollTop = box.scrollHeight;
}

function renderMembers(members) {
  $('room-count').textContent = `(${members.length})`;
  $('room-members').innerHTML = members
    .map(
      (m) =>
        `<li><span class="avatar" aria-hidden="true">${escapeHtml(initials(m.name))}</span>` +
        `<span class="nm">${escapeHtml(m.name)}${m.me ? ' (você)' : ''}</span>` +
        (m.owner ? '<span class="tag">Criador</span>' : '') +
        '</li>',
    )
    .join('');
}

async function sendMessage(event) {
  event.preventDefault();
  const room = state.room;
  const input = $('chat-input');
  const body = input.value.trim();
  if (!room || !body) return;
  $('chat-err').textContent = '';
  input.value = '';
  try {
    // Aqui enviamos apenas texto. Se o back-end suportar, você pode passar o link do arquivo aqui.
    await api.communities.send(room.id, body, null, null);
    room.signature = ''; // força redesenhar com a nova mensagem
    await refreshRoom(true);
  } catch (err) {
    input.value = body; // não perde o texto digitado
    if (err instanceof ApiError && err.status === 401) return location.replace('login.html');
    $('chat-err').textContent = err instanceof ApiError ? err.message : 'Não foi possível enviar a mensagem.';
  }
  input.focus();
}

/* ---------- LÓGICA DE UPLOAD DO CHAT ---------- */
async function uploadAttachment(event) {
  const file = event.target.files[0];
  if (!file || !state.room) return;

  const btn = $('btn-attach');
  const input = $('file-input');

  if (file.size > MAX_CHAT_UPLOAD) {
    $('chat-err').textContent = `O arquivo tem ${formatSize(file.size)}. O limite é 50 MB.`;
    input.value = '';
    return;
  }

  $('chat-err').textContent = '';
  btn.disabled = true;
  btn.innerHTML = '⏳'; // Ícone de carregando

  try {
    // Cria nome único para o arquivo
    const fileName = `${state.room.id}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
    
    // Upload para o Supabase Storage
    const { data, error } = await supabase.storage
      .from('chat-attachments')
      .upload(fileName, file);

    if (error) throw error;

    // Gera URL assinada válida por 1 hora
    const { data: urlData, error: urlError } = await supabase.storage
      .from('chat-attachments')
      .createSignedUrl(data.path, 3600);

    if (urlError) throw urlError;

    // Envia a mensagem para o back-end da sua API, passando a URL e o tipo do arquivo
    await api.communities.send(state.room.id, '', urlData.signedUrl, file.type);
    
    // Atualiza o chat
    state.room.signature = ''; 
    await refreshRoom(true);

  } catch (err) {
    console.error(err);
    $('chat-err').textContent = 'Erro ao enviar o arquivo. Tente novamente.';
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"></path></svg>`;
    input.value = '';
  }
}

/* ---------- LÓGICA DO MODAL DE MATERIAIS (OPÇÃO 2) ---------- */
async function abrirModalMateriais() {
  $('modal-materiais').classList.add('s');
  const lista = $('lista-materiais-chat');
  lista.innerHTML = '<p style="text-align:center;color:var(--mut);font-size:13px">Carregando materiais...</p>';
  
  try {
    const data = await api.materials.list({ sort: 'recent' });
    
    if (data.items.length === 0) {
      lista.innerHTML = '<p style="text-align:center;color:var(--mut);font-size:13px">Nenhum material encontrado.</p>';
      return;
    }

    lista.innerHTML = data.items.map(m => `
      <button type="button" class="card-material-chat" onclick="window.enviarMaterialDoChat(${m.id}, '${escapeHtml(m.title)}', '${escapeHtml(m.fileName || 'Arquivo.pdf')}')">
        <strong style="color:var(--fg); font-size:14px">${escapeHtml(m.title)}</strong>
        <span style="color:var(--mut); font-size:12px">${escapeHtml(m.category)} · ${escapeHtml(m.author)}</span>
      </button>
    `).join('');

  } catch (err) {
    lista.innerHTML = '<p style="text-align:center;color:var(--err);font-size:13px">Erro ao carregar materiais.</p>';
  }
}

// Função chamada pelo botão do material (inline)
window.enviarMaterialDoChat = async function(id, titulo, nomeArquivo) {
  // Fecha o modal
  $('modal-materiais').classList.remove('s');
  
  const btn = $('btn-attach');
  btn.disabled = true;
  btn.innerHTML = '⏳';

  try {
    // 1. Faz o download do arquivo pela API (para manter o login e contar os downloads)
    const blob = await api.materials.download(id);
    
    // 2. Cria um link local (temporário) para o arquivo
    const urlLocal = URL.createObjectURL(blob);
    
    // 3. Envia a mensagem no chat com esse link local e o tipo forçado como PDF
    await api.communities.send(state.room.id, `Enviou o material: ${titulo}`, urlLocal, 'application/pdf');
    
    // Atualiza o chat
    state.room.signature = ''; 
    await refreshRoom(true);

    // (Opcional) Libera a memória depois de 1 minuto
    setTimeout(() => URL.revokeObjectURL(urlLocal), 60000);

  } catch (err) {
    console.error(err);
    $('chat-err').textContent = 'Erro ao enviar o material. Verifique sua conexão.';
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"></path></svg>`;
  }
};

async function deleteMessage(messageId) {
  const room = state.room;
  if (!room || !confirm('Excluir esta mensagem?')) return;
  try {
    await api.communities.removeMessage(room.id, messageId);
    room.signature = '';
    await refreshRoom(false);
  } catch (err) {
    handleError(err, 'Não foi possível excluir a mensagem.');
  }
}

async function leaveRoom() {
  const room = state.room;
  if (!room || !confirm('Sair desta comunidade? Você perderá o acesso ao chat.')) return;
  try {
    await api.communities.leave(room.id);
    say('Você saiu da comunidade.');
    closeRoom();
    loadCommunities();
  } catch (err) {
    handleError(err, 'Não foi possível sair da comunidade.');
  }
}

/* ---------- Estrutura da página ---------- */

function closeModals() {
  $('mm').classList.remove('s');
  $('mc').classList.remove('s');
  $('modal-materiais')?.classList.remove('s');
}

function bindEvents() {
  const reloadMat = debounce(loadMaterials, 250);
  $('q')?.addEventListener('input', reloadMat);
  $('cat')?.addEventListener('change', loadMaterials);
  $('area')?.addEventListener('change', loadMaterials);
  $('sort-mat')?.addEventListener('change', loadMaterials);
  $('scope-mat')?.addEventListener('change', loadMaterials);

  const reloadCom = debounce(loadCommunities, 250);
  $('qc')?.addEventListener('input', reloadCom);
  $('fc')?.addEventListener('change', loadCommunities);
  $('sort-com')?.addEventListener('change', loadCommunities);

  setTab = initTabs(['mat', 'com'], {
    onChange: (key) => history.replaceState(null, '', key === 'com' ? '#comunidades' : '#apostilas'),
  });

  $('f-material').addEventListener('submit', addMaterial);
  $('f-community').addEventListener('submit', addCommunity);

  const actions = {
    'open-material': openMaterialModal,
    'open-community': openCommunityModal,
    'close-modal': closeModals,
    'close-room': closeRoom,
    'leave-room': leaveRoom,
  };
  const itemActions = {
    download: downloadMaterial,
    'delete-material': deleteMaterial,
    'toggle-community': toggleCommunity,
    'delete-community': deleteCommunity,
    'open-room': openRoom,
    'delete-message': deleteMessage,
  };
  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action) actions[action]?.();
    const item = event.target.closest('[data-act]');
    if (item) itemActions[item.dataset.act]?.(Number(item.dataset.id));
    if (event.target.closest('[data-logout]')) logout(event);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModals();
  });

  $('f-chat').addEventListener('submit', sendMessage);
  
  // --- NOVA LÓGICA DO BOTÃO DE ANEXO ---
  const btnAttach = $('btn-attach');
  const attachMenu = $('attach-menu');
  const fileInput = $('file-input');

  // Abre/fecha o menu
  btnAttach?.addEventListener('click', (e) => {
    e.stopPropagation();
    attachMenu.hidden = !attachMenu.hidden;
  });

  // Fecha o menu se clicar fora
  document.addEventListener('click', (e) => {
    if (attachMenu && !attachMenu.hidden && !attachMenu.contains(e.target) && e.target !== btnAttach) {
      attachMenu.hidden = true;
    }
  });

  // Opção 1: Upload do PC
  $('opt-upload-pc')?.addEventListener('click', () => {
    attachMenu.hidden = true;
    fileInput.click();
  });

  // Opção 2: Materiais da Plataforma
  $('opt-upload-plataforma')?.addEventListener('click', () => {
    attachMenu.hidden = true;
    abrirModalMateriais();
  });

  // Evento de mudança do arquivo
  fileInput?.addEventListener('change', uploadAttachment);
  
  // Busca no modal de materiais
  $('busca-material-chat')?.addEventListener('input', (e) => {
    const termo = e.target.value.toLowerCase();
    const botoes = document.querySelectorAll('#lista-materiais-chat button');
    botoes.forEach(btn => {
      const titulo = btn.querySelector('strong').textContent.toLowerCase();
      btn.style.display = titulo.includes(termo) ? 'flex' : 'none';
    });
  });

  window.addEventListener('hashchange', route);
}

async function logout(event) {
  event.preventDefault();
  try {
    await api.auth.logout();
  } finally {
    location.replace('index.html');
  }
}

async function start() {
  const path = location.hash === '#com' || location.hash === '#comunidades' ? 'communities' : 'materials';
  initSidebar({ active: path });

  try {
    state.me = await api.auth.me();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return location.replace('login.html');
    return say('Não foi possível conectar ao servidor.');
  }
  const firstName = (state.me.name || 'estudante').split(' ')[0];
  const created = state.me.createdAt ? new Date(state.me.createdAt).getTime() : 0;
  const isNew = created && Date.now() - created < 30 * 60 * 1000; // conta com menos de 30 min
  setSidebarUser(state.me);
  $('hi').textContent = isNew
    ? `Bem-vindo, ${state.me.name || 'estudante'}!`
    : `Bem-vindo de volta, ${state.me.name || 'estudante'}!`;
  if (state.me.isAdmin) {
    const link = $('admin-link');
    if (link) link.hidden = false;
    document.querySelectorAll('a[href="feedback.html"]').forEach((a) => {
      a.hidden = true;
    });
  }
  bindEvents();
  loadMaterials();
  loadCommunities();
  route();
}

start();