import { ApiError, api } from '../lib/api.js';
import { $, escapeHtml, initTabs } from '../lib/dom.js';

const state = { me: null };

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

function renderOverview(data) {
  $('s-users-month').textContent = data.usersCreatedLastMonth.toLocaleString('pt-BR');
  $('s-active').textContent = data.activeUsersLive.toLocaleString('pt-BR');
  $('s-communities').textContent = data.communitiesCreated.toLocaleString('pt-BR');
  $('s-total-users').textContent = data.totalUsers.toLocaleString('pt-BR');
  $('s-materials').textContent = data.totalMaterials.toLocaleString('pt-BR');
  $('s-downloads').textContent = data.totalDownloads.toLocaleString('pt-BR');

  const usersBody = $('t-users');
  if (!data.recentUsers.length) {
    usersBody.innerHTML = '<tr><td colspan="4" class="empty">Nenhum usuário ainda.</td></tr>';
  } else {
    usersBody.innerHTML = data.recentUsers
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

async function loadStats() {
  try {
    const data = await api.admin.stats();
    renderOverview(data);
    renderHappiness(data.happiness);
    renderFeedbacks(data.feedbacks);
    $('msg').hidden = true;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      return location.replace('login.html');
    }
    say(err instanceof ApiError ? err.message : 'Não foi possível carregar as estatísticas.');
  }
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

  await loadStats();
  setInterval(loadStats, 30_000);
}

start();
