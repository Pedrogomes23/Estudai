import { ApiError, api } from '../lib/api.js';
import { $, debounce, escapeHtml, ICON_DOWNLOAD } from '../lib/dom.js';
import { initSidebar, setSidebarUser } from '../lib/sidebar.js';

const state = {
  me: null,
  stats: null,
  materials: [],
  sort: 'recent',
  view: 'feed',
  disciplines: [],
};

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] || '')
    .join('')
    .toUpperCase();
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function say(text) {
  const box = $('msg');
  box.textContent = text;
  box.hidden = false;
  clearTimeout(say._t);
  say._t = setTimeout(() => (box.hidden = true), 3200);
}

function handleError(err, fallback) {
  if (err instanceof ApiError && err.status === 401) {
    location.replace('login.html');
    return;
  }
  say(err instanceof ApiError ? err.message : fallback);
}

/* ---------- Bootstrap ---------- */

async function boot() {
  initSidebar({ active: 'feed' });

  try {
    const [profile, materials, activities, notifs] = await Promise.all([
      api.profile.me(),
      api.materials.list({ sort: 'recent' }),
      api.profile.activities().catch(() => []),
      api.notifications.list().catch(() => ({ items: [], unread: 0 })),
    ]);

    state.me = profile.user;
    state.stats = profile.stats;
    state.materials = materials.items || [];

    renderUser();
    renderStats();
    renderFeed();
    renderActivities(activities);
    renderNotifications(notifs);

    // Links vindos de outras páginas (#my-files, #my-downloads, etc.)
    const hash = (location.hash || '').replace('#', '');
    if (hash && ['my-files', 'my-downloads', 'my-communities', 'admin-communities'].includes(hash)) {
      const link = document.querySelector(`[data-nav="${hash}"]`);
      link?.click();
    }
  } catch (err) {
    handleError(err, 'Não foi possível carregar sua área pessoal.');
  }
}

function renderUser() {
  const u = state.me;
  if (!u) return;
  const created = u.createdAt ? new Date(u.createdAt).getTime() : 0;
  const isNew = created && Date.now() - created < 30 * 60 * 1000;
  $('greet-title').textContent = isNew
    ? `Bem-vindo, ${u.name.split(' ')[0]}!`
    : `Bem-vindo de volta, ${u.name.split(' ')[0]}!`;
  setSidebarUser(u);
}

function renderStats() {
  const s = state.stats || {};
  $('stat-materials').textContent = s.materials ?? 0;
  $('stat-downloads').textContent = s.downloads ?? 0;
  $('stat-joined').textContent = s.communitiesJoined ?? 0;
  $('stat-owned').textContent = s.communitiesOwned ?? 0;
}

function renderFeed() {
  const list = $('feed-list');
  const items = state.materials;
  if (!items.length) {
    list.innerHTML = '<div class="empty">Nenhum material encontrado. Seja o primeiro a compartilhar!</div>';
    return;
  }
  list.innerHTML = items
    .map(
      (m) => `
    <article class="mcard">
      <div>
        <span class="tag">${escapeHtml(m.category)}</span>
        <span class="tag" style="background:var(--line);color:var(--fg);margin-left:6px">${escapeHtml(m.area || 'Outros')}</span>
        <h3>${escapeHtml(m.title)}</h3>
        <div class="meta">${escapeHtml([m.area, m.discipline].filter(Boolean).join(' · '))} · por ${escapeHtml(m.author)} · ${formatDate(m.createdAt)}</div>
      </div>
      <div></div>
      ${m.description ? `<p class="desc">${escapeHtml(m.description)}</p>` : ''}
      <div class="acts">
        <span class="stat">${ICON_DOWNLOAD} ${m.downloads} downloads</span>
        <button class="btn p sm" data-act="download" data-id="${m.id}">Baixar</button>
        ${m.mine ? `<button class="lnk" data-act="delete" data-id="${m.id}">Excluir</button>` : ''}
      </div>
    </article>`,
    )
    .join('');
}

function renderActivities(items) {
  const box = $('activities');
  if (!items?.length) {
    box.innerHTML = '<div class="empty">Suas atividades aparecerão aqui.</div>';
    return;
  }
  const labels = {
    upload: 'Você enviou',
    download: 'Você baixou',
    join: 'Entrou em',
    community_material: 'Novo material em',
  };
  box.innerHTML = items
    .map(
      (a) => `
    <div class="act-item">
      <span class="act-dot"></span>
      <div>
        <div><strong>${labels[a.type] || a.type}</strong> ${escapeHtml(a.title)}${
          a.meta?.community ? ` (${escapeHtml(a.meta.community)})` : ''
        }</div>
        <div class="t">${formatDate(a.at)}</div>
      </div>
    </div>`,
    )
    .join('');
}

function renderNotifications(data) {
  const badge = $('notif-badge');
  const list = $('notif-list');
  const unread = data.unread || 0;
  if (unread > 0) {
    badge.hidden = false;
    badge.textContent = unread > 9 ? '9+' : String(unread);
  } else {
    badge.hidden = true;
  }
  if (!data.items?.length) {
    list.innerHTML = '<div class="empty" style="padding:16px">Nenhuma notificação.</div>';
    return;
  }
  list.innerHTML = data.items
    .map(
      (n) => `
    <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
      <div class="nt">${escapeHtml(n.title)}</div>
      <div class="nb">${escapeHtml(n.body || '')}</div>
    </div>`,
    )
    .join('');
}

/* ---------- Actions ---------- */

async function loadMaterials() {
  try {
    const filters = {
      q: $('q').value.trim(),
      category: $('cat').value,
      area: $('area')?.value || '',
      sort: state.sort,
    };
    if (state.view === 'my-files') filters.mine = '1';
    const data = await api.materials.list(filters);
    state.materials = data.items || [];
    renderFeed();
  } catch (err) {
    handleError(err, 'Erro ao carregar materiais.');
  }
}

async function loadMyDownloads() {
  try {
    const items = await api.materials.myDownloads();
    state.materials = items;
    renderFeed();
  } catch (err) {
    handleError(err, 'Erro ao carregar downloads.');
  }
}

async function loadCommunities(joinedOnly) {
  try {
    const items = await api.communities.list({ joined: joinedOnly ? '1' : undefined });
    const list = $('feed-list');
    if (!items.length) {
      list.innerHTML = '<div class="empty">Nenhuma comunidade encontrada.</div>';
      return;
    }
    list.innerHTML = items
      .map(
        (c) => `
      <article class="mcard">
        <div>
          <h3>${escapeHtml(c.name)}</h3>
          <div class="meta">${c.members} membros ${c.joined ? '· você participa' : ''} ${c.mine ? '· você administra' : ''}</div>
        </div>
        <div></div>
        <p class="desc">${escapeHtml(c.description || '')}</p>
        <div class="acts">
          <a class="btn p sm" href="plataforma.html">Abrir na plataforma</a>
        </div>
      </article>`,
      )
      .join('');
  } catch (err) {
    handleError(err, 'Erro ao carregar comunidades.');
  }
}

async function downloadMaterial(id) {
  try {
    const item = state.materials.find((m) => m.id === id);
    const blob = await api.materials.download(id);
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: item?.fileName || 'material',
    });
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    say('Download iniciado.');
    if (state.stats) {
      state.stats.downloads = (state.stats.downloads || 0) + 1;
      renderStats();
    }
  } catch (err) {
    handleError(err, 'Não foi possível baixar.');
  }
}

async function deleteMaterial(id) {
  if (!confirm('Excluir este material?')) return;
  try {
    await api.materials.remove(id);
    state.materials = state.materials.filter((m) => m.id !== id);
    renderFeed();
    say('Material excluído.');
  } catch (err) {
    handleError(err, 'Não foi possível excluir.');
  }
}

/* ---------- Events ---------- */

document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (act) {
    const id = Number(act.dataset.id);
    if (act.dataset.act === 'download') downloadMaterial(id);
    if (act.dataset.act === 'delete') deleteMaterial(id);
    return;
  }

  const chip = e.target.closest('.chip');
  if (chip) {
    document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    if (chip.dataset.sort) {
      state.sort = chip.dataset.sort;
      state.view = 'feed';
      loadMaterials();
    }
    if (chip.dataset.view === 'for-you') {
      state.view = 'for-you';
      state.sort = 'recent';
      loadMaterials();
    }
    if (chip.dataset.view === 'communities') {
      state.view = 'communities';
      loadCommunities(false);
    }
    return;
  }

  const nav = e.target.closest('[data-nav]');
  if (nav) {
    e.preventDefault();
    const key = nav.dataset.nav;
    document.querySelectorAll('.side-nav a').forEach((a) => a.classList.remove('active'));
    nav.classList.add('active');
    if (key === 'feed') {
      state.view = 'feed';
      loadMaterials();
    } else if (key === 'my-files') {
      state.view = 'my-files';
      loadMaterials();
    } else if (key === 'my-downloads') {
      state.view = 'my-downloads';
      loadMyDownloads();
    } else if (key === 'my-communities') {
      state.view = 'my-communities';
      loadCommunities(true);
    } else if (key === 'admin-communities') {
      state.view = 'admin-communities';
      loadCommunities(false).then(() => {
        /* filter owned client-side if needed */
      });
      api.communities.list({}).then((items) => {
        const owned = items.filter((c) => c.mine);
        const list = $('feed-list');
        if (!owned.length) {
          list.innerHTML = '<div class="empty">Você ainda não administra nenhuma comunidade.</div>';
          return;
        }
        list.innerHTML = owned
          .map(
            (c) => `
          <article class="mcard">
            <div><h3>${escapeHtml(c.name)}</h3><div class="meta">${c.members} membros · você administra</div></div>
            <div></div>
            <p class="desc">${escapeHtml(c.description || '')}</p>
            <div class="acts"><a class="btn p sm" href="plataforma.html">Gerenciar</a></div>
          </article>`,
          )
          .join('');
      });
    } else if (key === 'materials' || key === 'communities') {
      location.href = nav.getAttribute('href');
    } else if (key === 'profile') {
      location.href = 'profile.html';
    } else if (key === 'settings') {
      location.href = 'feedback.html';
    }
    return;
  }

  if (e.target.closest('[data-logout]')) {
    e.preventDefault();
    api.auth.logout().finally(() => location.replace('index.html'));
  }

  if (e.target.closest('#btn-notif')) {
    const panel = $('notif-panel');
    panel.hidden = !panel.hidden;
  } else if (!$('notif-panel').contains(e.target) && e.target.id !== 'btn-notif') {
    $('notif-panel').hidden = true;
  }

  if (e.target.closest('#notif-read-all')) {
    api.notifications.markAllRead().then(() => {
      $('notif-badge').hidden = true;
      document.querySelectorAll('.notif-item').forEach((el) => el.classList.remove('unread'));
    });
  }

  const notifItem = e.target.closest('.notif-item');
  if (notifItem) {
    api.notifications.markRead(notifItem.dataset.id).catch(() => {});
    notifItem.classList.remove('unread');
  }
});

$('q').addEventListener(
  'input',
  debounce(() => {
    if (state.view === 'communities' || state.view === 'my-communities') return;
    loadMaterials();
  }, 250),
);
$('cat').addEventListener('change', () => loadMaterials());
$('area')?.addEventListener('change', () => loadMaterials());
$('area')?.addEventListener('change', () => loadMaterials());


boot();
