import { ApiError, api } from '../lib/api.js';
import { $, debounce, escapeHtml } from '../lib/dom.js';
import { lockScroll, unlockScroll } from '../lib/scroll-lock.js';
import { initSidebar, setSidebarUser } from '../lib/sidebar.js';

const state = {
  me: null,
  stats: null,
  materials: [],
  sort: 'recent',
  view: 'feed',
  disciplines: [],
};

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
    // Tudo sai ao mesmo tempo (antes: 2 pedidos e, só depois, mais 2 em fila = mais espera).
    const activitiesReq = api.profile.activities().catch(() => []);
    const notificationsReq = api.notifications
      .list()
      .catch(() => ({ items: [], unread: 0 }));

    const [profile, materials] = await Promise.all([
      api.profile.me(),
      api.materials.list({ sort: 'recent' }),
    ]);

    state.me = profile.user;
    state.stats = profile.stats;
    state.materials = materials.items || [];
    cacheSet(materialsKey({ q: '', category: '', area: '', sort: 'recent' }), state.materials);

    renderUser();
    renderStats();
    renderFeed();

    await Promise.all([
      activitiesReq.then(renderActivities),
      notificationsReq.then(renderNotifications),
    ]);
    startNotificationPolling();

    // Links vindos de outras páginas (#my-files, #my-downloads, etc.)
    const hash = (location.hash || '').replace('#', '');
    if (hash && IN_PAGE_VIEWS.has(hash) && hash !== 'feed') {
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

function renderViewHeader() {
  const title = $('greet-title');
  const description = document.querySelector('.greet p');
  const quickCards = $('quick-cards');
  const filters = $('filters');
  const search = $('q');

  const views = {
    feed: ['Bem-vindo!', 'Descubra materiais da comunidade e acompanhe suas atividades.'],
    'my-files': ['Meus arquivos', 'Sua biblioteca pessoal de materiais compartilhados.'],
    'my-downloads': ['Meus downloads', 'Consulte os materiais que você baixou recentemente.'],
    'my-communities': ['Minhas comunidades', 'Acompanhe as comunidades das quais você participa.'],
    'admin-communities': [
      'Comunidades que administro',
      'Gerencie as comunidades que estão sob sua responsabilidade.',
    ],
  };

  const current = views[state.view] || views.feed;
  if (title) title.textContent = state.view === 'feed' ? `${current[0]}` : current[0];

  if (description) description.textContent = current[1];

  if (quickCards) quickCards.hidden = state.view !== 'feed';

  if (filters) {
    filters.hidden = ['my-downloads', 'my-communities', 'admin-communities'].includes(state.view);
  }

  if (search) {
    search.placeholder =
      state.view === 'my-files' ? 'Buscar nos meus arquivos' : 'Buscar materiais e conteúdos';
  }

  const list = $('feed-list');
  if (list) list.dataset.view = state.view;
}

function renderEmpty(message, icon) {
  return `
    <div class="view-empty">
      <div class="view-empty-icon">${icon}</div>
      <strong>${escapeHtml(message)}</strong>
    </div>`;
}

function renderFeed() {
  const list = $('feed-list');
  const items = state.materials || [];

  if (state.view === 'my-downloads') {
    if (!items.length) {
      list.innerHTML = renderEmpty('Você ainda não baixou nenhum material.', '↓');
      return;
    }

    list.innerHTML = items
      .map(
        (m) => `
      <article class="download-card">
        <div class="download-card-icon">↓</div>
        <div class="download-card-content">
          <span class="view-kicker">Material baixado</span>
          <h3>${escapeHtml(m.title)}</h3>
          <div class="view-meta">
            ${escapeHtml(m.category || 'Material')}
            · Baixado em ${formatDate(m.downloadedAt)}
          </div>
          <div class="view-meta">Enviado por ${escapeHtml(m.author || 'Usuário')}</div>
        </div>
        <button class="btn p sm" data-act="download" data-id="${m.id}">Baixar novamente</button>
      </article>
    `,
      )
      .join('');
    return;
  }

  if (!items.length) {
    list.innerHTML = renderEmpty(
      state.view === 'my-files' ? 'Sua biblioteca ainda está vazia.' : 'Nenhum material encontrado.',
      '▤',
    );
    return;
  }

  list.innerHTML = items
    .map(
      (m) => `
    <article class="library-card">
      <div class="library-file-icon">▤</div>
      <div class="library-card-content">
        <div class="library-tags">
          <span class="tag">${escapeHtml(m.category || 'Material')}</span>
          <span class="library-area">${escapeHtml(m.area || 'Outros')}</span>
        </div>
        <h3>${escapeHtml(m.title)}</h3>
        <div class="view-meta">
          ${escapeHtml(m.discipline || m.area || 'Material de estudo')}
          · ${formatDate(m.createdAt)}
        </div>
        ${m.description ? `<p class="library-description">${escapeHtml(m.description)}</p>` : ''}
        <div class="library-actions">
          <span class="view-meta">${m.downloads || 0} downloads</span>
          <button class="btn p sm" data-act="download" data-id="${m.id}">Baixar</button>
          ${m.mine ? `<button class="lnk" data-act="delete" data-id="${m.id}">Excluir</button>` : ''}
        </div>
      </div>
    </article>
  `,
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

let unreadCount = 0;

/** Atualiza o número vermelho do sininho. */
function setUnread(value) {
  unreadCount = Math.max(0, value);
  knownUnread = unreadCount; // mantém a checagem automática em sincronia
  const badge = $('notif-badge');
  if (unreadCount > 0) {
    badge.hidden = false;
    badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
  } else {
    badge.hidden = true;
  }
}

// ---- Atualização automática do sininho ----
const NOTIF_POLL_MS = 15000;
let knownLatestId = null;
let knownUnread = null;
let notifPolling = false;

/** Pergunta ao servidor (de forma leve) se chegou notificação nova e, se sim, atualiza o sininho. */
async function pollNotifications() {
  if (notifPolling || document.hidden) return;
  notifPolling = true;
  try {
    const s = await api.notifications.summary();
    const changed = s.latestId !== knownLatestId || s.unread !== knownUnread;
    if (changed) {
      const data = await api.notifications.list();
      const hadNew = knownLatestId !== null && data.items?.some((n) => n.id > knownLatestId && !n.read);
      renderNotifications(data);
      if (hadNew) {
        const bell = $('btn-notif');
        bell?.classList.remove('notif-ping');
        void bell?.offsetWidth; // reinicia a animação
        bell?.classList.add('notif-ping');
      }
    }
  } catch {
    /* rede instável ou sessão expirada: tenta de novo no próximo ciclo */
  } finally {
    notifPolling = false;
  }
}

function startNotificationPolling() {
  setInterval(pollNotifications, NOTIF_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pollNotifications();
  });
  window.addEventListener('focus', pollNotifications);
  window.addEventListener('online', pollNotifications);
}

function renderNotifications(data) {
  const list = $('notif-list');
  knownLatestId = (data.items || []).reduce((m, n) => Math.max(m, Number(n.id) || 0), knownLatestId || 0);
  knownUnread = data.unread || 0;
  setUnread(data.unread || 0);
  if (!data.items?.length) {
    list.innerHTML = '<div class="empty" style="padding:16px">Nenhuma notificação.</div>';
    return;
  }
  list.innerHTML = data.items
    .map(
      (n) => `
    <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}" data-type="${escapeHtml(n.type || '')}" data-title="${escapeHtml(n.title)}" data-body="${escapeHtml(n.body || '')}" data-link="${escapeHtml(n.link || '')}">
      <div class="nt">${escapeHtml(n.title)}</div>
      <div class="nb">${escapeHtml(n.body || '')}</div>
    </div>`,
    )
    .join('');
}

// Um <div> recém-criado nasce "não escondido", por isso a trava é controlada por esta variável.
let modalLocked = false;

function openNotifModal(title, body, items = []) {
  let modal = document.getElementById('notif-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'notif-modal';
    modal.className = 'notif-modal';
    modal.innerHTML = `
      <div class="notif-modal-card" role="dialog" aria-modal="true" aria-labelledby="notif-modal-title">
        <h3 id="notif-modal-title"></h3>
        <p class="notif-modal-body"></p>
        <ul class="notif-modal-list" hidden></ul>
        <button type="button" class="btn notif-modal-ok">Entendi</button>
      </div>`;
    document.body.append(modal);
    const close = () => {
      if (!modalLocked) return;
      modalLocked = false;
      modal.hidden = true;
      unlockScroll();
    };
    modal.querySelector('.notif-modal-ok').addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) close();
    });
  }
  modal.querySelector('#notif-modal-title').textContent = title || 'Aviso';
  const bodyEl = modal.querySelector('.notif-modal-body');
  bodyEl.textContent = body || '';
  bodyEl.hidden = !body;
  const list = modal.querySelector('.notif-modal-list');
  list.replaceChildren(
    ...items.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }),
  );
  list.hidden = items.length === 0;
  if (!modalLocked) {
    modalLocked = true;
    lockScroll();
  }
  modal.hidden = false;
}


/* ---------- Actions ---------- */

/* ---------- Cache por tela (mostra na hora e atualiza em segundo plano) ---------- */

const IN_PAGE_VIEWS = new Set(['feed', 'my-files', 'my-downloads', 'my-communities', 'admin-communities']);
const CACHE_FRESH_MS = 20_000; // até 20s: usa direto, sem nova ida ao servidor
const CACHE_MAX_ENTRIES = 40;
const viewCache = new Map();
let requestSeq = 0; // descarta respostas atrasadas de uma tela que a pessoa já deixou

function cacheSet(key, data) {
  viewCache.delete(key);
  viewCache.set(key, { at: Date.now(), data });
  if (viewCache.size > CACHE_MAX_ENTRIES) viewCache.delete(viewCache.keys().next().value);
}

const materialsKey = (f) => `m:${f.q || ''}|${f.category || ''}|${f.area || ''}|${f.sort || ''}|${f.mine || ''}`;

function materialFilters(view = state.view) {
  const filters = {
    q: $('q').value.trim(),
    category: $('cat').value,
    area: $('area')?.value || '',
    sort: state.sort,
  };
  if (view === 'my-files') filters.mine = '1';
  return filters;
}

const fetchMaterials = (filters) => api.materials.list(filters).then((d) => d.items || []);
const fetchCommunities = (joinedOnly, mineOnly) =>
  api.communities
    .list({ joined: joinedOnly ? '1' : undefined })
    .then((items) => (mineOnly ? items.filter((c) => c.mine) : items));

function applyMaterials(items) {
  state.materials = items;
  renderFeed();
}

/** Descreve de onde vêm os dados de cada tela. */
function sourceFor(view) {
  if (view === 'my-downloads') {
    return {
      key: 'downloads',
      fetch: () => api.materials.myDownloads(),
      apply: applyMaterials,
      error: 'Erro ao carregar downloads.',
    };
  }
  if (view === 'communities' || view === 'my-communities' || view === 'admin-communities') {
    const joinedOnly = view === 'my-communities';
    const mineOnly = view === 'admin-communities';
    return {
      key: `c:${joinedOnly ? 1 : 0}:${mineOnly ? 1 : 0}`,
      fetch: () => fetchCommunities(joinedOnly, mineOnly),
      apply: (items) => renderCommunities(items, mineOnly),
      error: 'Erro ao carregar comunidades.',
    };
  }
  const filters = materialFilters(view);
  return {
    key: materialsKey(filters),
    fetch: () => fetchMaterials(filters),
    apply: applyMaterials,
    error: 'Erro ao carregar materiais.',
  };
}

function showSkeleton() {
  $('feed-list').innerHTML = '<div class="skeleton"></div>'.repeat(3);
}

/** Mostra o que já temos na hora; busca de novo só se estiver velho. */
async function showView(view) {
  const src = sourceFor(view);
  const seq = ++requestSeq;
  const hit = viewCache.get(src.key);

  if (hit) src.apply(hit.data);
  else showSkeleton();

  if (hit && Date.now() - hit.at < CACHE_FRESH_MS) return;

  try {
    const data = await src.fetch();
    cacheSet(src.key, data);
    if (seq === requestSeq) src.apply(data);
  } catch (err) {
    if (seq === requestSeq) handleError(err, src.error);
  }
}

/** Ao passar o mouse num item do menu, já busca os dados (quando clicar, aparece na hora). */
const warming = new Set();
function warmView(view) {
  const src = sourceFor(view);
  const hit = viewCache.get(src.key);
  if ((hit && Date.now() - hit.at < CACHE_FRESH_MS) || warming.has(src.key)) return;
  warming.add(src.key);
  src
    .fetch()
    .then((data) => cacheSet(src.key, data))
    .catch(() => {})
    .finally(() => warming.delete(src.key));
}

const loadMaterials = () => showView(state.view);

function renderCommunities(items, mineOnly) {
  const list = $('feed-list');

  if (!items.length) {
    list.innerHTML = renderEmpty(
      mineOnly
        ? 'Você ainda não administra nenhuma comunidade.'
        : 'Você ainda não participa de nenhuma comunidade.',
      mineOnly ? '⚙' : '◎',
    );
    return;
  }

  list.innerHTML = items
    .map(
      (c) => `
      <article class="community-card ${mineOnly ? 'community-card-admin' : 'community-card-member'}">
        <div class="community-card-top">
          <span class="community-symbol">${mineOnly ? '⚙' : '◎'}</span>
          <span class="community-role">
            ${mineOnly ? 'Sua administração' : 'Comunidade participante'}
          </span>
        </div>
        <h3>${escapeHtml(c.name)}</h3>
        <p class="community-description">
          ${escapeHtml(c.description || 'Uma comunidade para compartilhar conhecimento.')}
        </p>
        <div class="community-card-bottom">
          <span class="view-meta">${c.members} participantes</span>
          <a class="btn p sm" href="plataforma.html">
            ${mineOnly ? 'Acessar gestão' : 'Abrir comunidade'}
          </a>
        </div>
      </article>
    `,
    )
    .join('');
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
    viewCache.delete('downloads');
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
    viewCache.clear();
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
    } else if (chip.dataset.view === 'for-you') {
      state.view = 'for-you';
      state.sort = 'recent';
    } else if (chip.dataset.view === 'communities') {
      state.view = 'communities';
    } else {
      return;
    }
    renderViewHeader();
    showView(state.view);
    return;
  }

  const nav = e.target.closest('[data-nav]');
  if (nav) {
    e.preventDefault();
    const key = nav.dataset.nav;

    // Páginas de verdade (materiais, perfil, Klyra...): navega normalmente.
    if (!IN_PAGE_VIEWS.has(key)) {
      location.href = nav.getAttribute('href');
      return;
    }

    document.querySelectorAll('.side-nav a').forEach((a) => a.classList.remove('active'));
    document.querySelector(`.side-nav [data-nav="${key}"]`)?.classList.add('active');

    // Antes o título era desenhado ANTES de trocar a tela, então ficava uma tela atrasado.
    state.view = key;
    renderViewHeader();
    showView(key);
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
      setUnread(0);
      document.querySelectorAll('.notif-item').forEach((el) => el.classList.remove('unread'));
    });
  }

  const notifItem = e.target.closest('.notif-item');
  if (notifItem) {
    // Ao abrir uma notificação não lida, ela vira lida e o número do sininho diminui.
    if (notifItem.classList.contains('unread')) {
      notifItem.classList.remove('unread');
      setUnread(unreadCount - 1);
      api.notifications.markRead(notifItem.dataset.id).catch(() => {
        // Se o servidor não confirmou, volta ao estado anterior.
        notifItem.classList.add('unread');
        setUnread(unreadCount + 1);
      });
    }
    // Atualização do site: abre balãozinho com a mensagem completa
    if (notifItem.dataset.type === 'site_update' || notifItem.dataset.type === 'welcome') {
      const { title, body, link } = notifItem.dataset;
      $('notif-panel').hidden = true;
      if (link?.startsWith('release:')) {
        // Novidade de deploy: busca o texto completo; se falhar, mostra o resumo.
        api.notifications
          .release(notifItem.dataset.id)
          .then((r) => openNotifModal(r.title || title, r.description || body, r.items || []))
          .catch(() => openNotifModal(title, body));
      } else {
        openNotifModal(title, body);
      }
    }
  }
});

document.addEventListener(
  'pointerover',
  (e) => {
    const nav = e.target.closest?.('[data-nav]');
    if (nav && IN_PAGE_VIEWS.has(nav.dataset.nav)) warmView(nav.dataset.nav);
  },
  { passive: true },
);

$('q').addEventListener(
  'input',
  debounce(() => {
    if (['communities', 'my-communities', 'admin-communities', 'my-downloads'].includes(state.view)) return;
    loadMaterials();
  }, 250),
);
$('cat').addEventListener('change', () => loadMaterials());
$('area')?.addEventListener('change', () => loadMaterials());

boot();
