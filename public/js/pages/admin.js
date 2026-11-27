import { ApiError, api } from '../lib/api.js';
import { $, escapeHtml, initTabs } from '../lib/dom.js';

const POLL_MS = 30_000;
const MAX_USERS_LIST = 1000; // mesmo teto do servidor (GET /api/admin/users)

const state = {
  me: null,
  recentUsers: [], // só os mais recentes (vem junto com as estatísticas)
  allUsers: null, // lista completa, buscada só ao clicar em "Exibir mais"
  totalUsers: 0,
  showAllUsers: false,
  loadingAllUsers: false,
  lastLoadAt: 0,
};

function say(text) {
  const box = $('msg');
  box.textContent = text;
  box.hidden = false;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

/** Estrelas cheias/vazias a partir da média (0–5). */
function starString(average) {
  const full = Math.round(Math.min(5, Math.max(0, average)));
  let out = '';
  for (let i = 1; i <= 5; i++) {
    out += i <= full ? '★' : '<span class="empty">★</span>';
  }
  return out;
}

function renderStarsInline(rating) {
  let out = '';
  for (let i = 1; i <= 5; i++) out += i <= rating ? '★' : '☆';
  return out;
}

function renderHappiness(happiness) {
  const avg = Number(happiness?.average) || 0;
  const total = happiness?.total || 0;
  const dist = happiness?.distribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  $('h-average').textContent = total ? avg.toFixed(1).replace('.', ',') : '0,0';
  $('h-stars').innerHTML = starString(avg);
  $('h-total').textContent =
    total === 0 ? 'Nenhuma avaliação ainda' : `${total.toLocaleString('pt-BR')} avaliaç${total === 1 ? 'ão' : 'ões'}`;

  // Proporcional ao maior valor (escadinha ao vivo). Zero = barra vazia.
  const counts = [5, 4, 3, 2, 1].map((n) => Number(dist[n]) || 0);
  const max = Math.max(0, ...counts);

  const rows = [5, 4, 3, 2, 1]
    .map((n, i) => {
      const count = counts[i];
      const pct = max > 0 && count > 0 ? Math.max(6, Math.round((count / max) * 100)) : 0;
      const fill =
        pct > 0
          ? `<div class="bar-fill" style="width:${pct}%"></div>`
          : '';
      return `<div class="bar-row${count === 0 ? ' is-zero' : ''}">
        <span>${n}★</span>
        <div class="bar-track">${fill}</div>
        <span class="count">${count}</span>
      </div>`;
    })
    .join('');
  $('h-bars').innerHTML = rows;
}

function renderFeedbacks(list) {
  const box = $('feedback-list');
  if (!list?.length) {
    box.innerHTML = '<p class="muted empty-msg">Nenhum feedback enviado pelos estudantes ainda.</p>';
    return;
  }
  box.innerHTML = list
    .map(
      (f) => `<article class="review">
        <div class="review-head">
          <span class="review-stars" aria-label="${f.rating} de 5">${renderStarsInline(f.rating)}</span>
          <span class="review-meta"><strong>${escapeHtml(f.userName)}</strong> · ${formatDate(f.createdAt)}</span>
        </div>
        <p class="review-msg">${escapeHtml(f.message)}</p>
        <div class="review-tags">
          <span class="tag">${escapeHtml(f.category)}</span>
          <span class="tag">${escapeHtml(f.area)}</span>
          ${f.allowContact ? '<span class="tag">Aceita contato</span>' : ''}
        </div>
      </article>`,
    )
    .join('');
}

function renderUsers() {
  const usersBody = $('t-users');
  const toggle = $('users-toggle');
  const expanded = state.showAllUsers && state.allUsers;
  const users = expanded ? state.allUsers : state.recentUsers;

  if (!users.length) {
    usersBody.innerHTML =
      '<tr><td colspan="4" class="empty">Nenhum usuário ainda.</td></tr>';
  } else {
    usersBody.innerHTML = users
      .map(
        (u) =>
          `<tr>
            <td>${escapeHtml(u.name)}</td>
            <td class="muted">${escapeHtml(u.email)}</td>
            <td>${formatDate(u.createdAt)}</td>
            <td>${u.isAdmin ? '<span class="badge">Admin</span>' : ''}</td>
          </tr>`,
      )
      .join('');
  }

  toggle.hidden = state.totalUsers <= state.recentUsers.length;
  toggle.disabled = state.loadingAllUsers;
  toggle.textContent = state.loadingAllUsers
    ? 'Carregando…'
    : state.showAllUsers
      ? 'Exibir menos'
      : 'Exibir mais';
}

function renderOverview(data) {
  $('s-users-month').textContent = data.usersCreatedLastMonth.toLocaleString('pt-BR');
  $('s-active').textContent = data.activeUsersLive.toLocaleString('pt-BR');
  $('s-communities').textContent = data.communitiesCreated.toLocaleString('pt-BR');
  $('s-total-users').textContent = data.totalUsers.toLocaleString('pt-BR');
  $('s-materials').textContent = data.totalMaterials.toLocaleString('pt-BR');
  $('s-downloads').textContent = data.totalDownloads.toLocaleString('pt-BR');

  state.recentUsers = data.recentUsers || [];
  state.totalUsers = data.totalUsers;
  // Se a lista completa já foi aberta e entrou alguém novo, atualiza-a em segundo plano.
  if (state.allUsers && state.allUsers.length !== Math.min(data.totalUsers, MAX_USERS_LIST)) {
    state.allUsers = null;
  }
  renderUsers();
  if (state.showAllUsers && !state.allUsers) loadAllUsers();

  const comBody = $('t-communities');
  if (!data.recentCommunities.length) {
    comBody.innerHTML = '<tr><td colspan="4" class="empty">Nenhuma comunidade ainda.</td></tr>';
  } else {
    comBody.innerHTML = data.recentCommunities
      .map(
        (c) =>
          `<tr>
            <td>${escapeHtml(c.name)}${c.isOfficial ? ' <span class="badge">Oficial</span>' : ''}</td>
            <td class="muted">${escapeHtml(c.creatorName || '—')}</td>
            <td>${c.members}</td>
            <td>${formatDate(c.createdAt)}</td>
          </tr>`,
      )
      .join('');
  }
}

async function loadAllUsers() {
  if (state.loadingAllUsers) return;
  state.loadingAllUsers = true;
  renderUsers();
  try {
    state.allUsers = await api.admin.users();
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      return location.replace('login.html');
    }
    state.showAllUsers = false;
    say(err instanceof ApiError ? err.message : 'Não foi possível carregar todos os usuários.');
  } finally {
    state.loadingAllUsers = false;
    renderUsers();
  }
}

let loading = false;

async function loadStats() {
  // Nunca deixa duas buscas em paralelo: se o servidor estiver lento, elas só se empilhariam.
  if (loading) return;
  loading = true;
  try {
    const data = await api.admin.stats();
    state.lastLoadAt = Date.now();
    renderOverview(data);
    renderHappiness(data.happiness);
    renderFeedbacks(data.feedbacks);
    $('msg').hidden = true;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      return location.replace('login.html');
    }
    say(err instanceof ApiError ? err.message : 'Não foi possível carregar as estatísticas.');
  } finally {
    loading = false;
  }
}

/** Atualiza a cada 30s a partir do FIM da busca anterior, e só com a aba visível. */
let pollTimer;
function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    if (!document.hidden) await loadStats();
    schedulePoll();
  }, POLL_MS);
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
  try {
    state.me = await api.auth.me();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return location.replace('login.html');
    return say('Não foi possível conectar ao servidor.');
  }

  if (!state.me.isAdmin) {
    return location.replace('feed.html');
  }

  $('hi').textContent = `Olá, ${state.me.name || 'admin'}`;
  initTabs(['overview', 'ratings']);
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-logout]')) logout(event);
  });
  $('users-toggle').addEventListener('click', () => {
    state.showAllUsers = !state.showAllUsers;
    renderUsers();
    if (state.showAllUsers && !state.allUsers) loadAllUsers();
  });

  // Ao voltar para a aba depois de um tempo, atualiza na hora.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - state.lastLoadAt > POLL_MS) loadStats();
  });

  await loadStats();
  schedulePoll();
}

start();

/* Aviso de atualização → sininho de todos + histórico */
function formatAnnDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function escapeAnn(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadAnnouncements() {
  const box = document.getElementById('announcement-list');
  if (!box) return;
  try {
    const items = await api.admin.listAnnouncements();
    if (!items?.length) {
      box.innerHTML = '<p class="muted" style="margin:0">Nenhum aviso enviado ainda.</p>';
      return;
    }
    box.innerHTML = items
      .map(
        (a) => `<article class="ann-item" data-id="${a.id}">
          <div class="ann-item-head">
            <strong>${escapeAnn(a.title)}</strong>
            <button type="button" class="lnk ann-del" data-id="${a.id}">Apagar</button>
          </div>
          <p class="ann-item-body">${escapeAnn(a.body)}</p>
          <div class="ann-item-meta muted">${formatAnnDate(a.createdAt)} · ${a.notified || 0} notificaç${(a.notified || 0) === 1 ? 'ão' : 'ões'}</div>
        </article>`,
      )
      .join('');
  } catch (err) {
    box.innerHTML = `<p class="muted" style="margin:0">${escapeAnn(err.message || 'Erro ao carregar avisos.')}</p>`;
  }
}

const annForm = document.getElementById('announcement-form');
if (annForm) {
  loadAnnouncements();
  annForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('ann-title').value.trim();
    const body = document.getElementById('ann-body').value.trim();
    const msg = document.getElementById('ann-msg');
    const btn = document.getElementById('ann-submit');
    if (!title || !body) return;
    btn.disabled = true;
    msg.hidden = true;
    try {
      const r = await api.admin.announce(title, body);
      msg.textContent = r.message || `Aviso enviado (${r.notified || 0} usuários).`;
      msg.hidden = false;
      annForm.reset();
      loadAnnouncements();
    } catch (err) {
      msg.textContent = err.message || 'Não foi possível enviar o aviso.';
      msg.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('announcement-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.ann-del');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (!id || !confirm('Apagar este aviso? Ele some do sininho de todos os usuários.')) return;
    btn.disabled = true;
    try {
      await api.admin.deleteAnnouncement(id);
      loadAnnouncements();
    } catch (err) {
      alert(err.message || 'Não foi possível apagar.');
      btn.disabled = false;
    }
  });
}
