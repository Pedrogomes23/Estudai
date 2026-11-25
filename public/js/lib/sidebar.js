import { api } from './api.js';
import { $ } from './dom.js';

const ICONS = {
  feed: '<svg viewBox="0 0 24 24"><path d="M3 10.5L12 3l9 7.5V21a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-10.5z"/></svg>',
  materials: '<svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>',
  communities: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><circle cx="16" cy="9" r="2.5"/><path d="M3 20c0-3.5 3-5.5 6-5.5s6 2 6 5.5"/><path d="M14 20c0-2.2 1.5-3.5 3.5-3.5S21 17.8 21 20"/></svg>',
  files: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>',
  downloads: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>',
  myCom: '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>',
  adminCom: '<svg viewBox="0 0 24 24"><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></svg>',
  profile: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dashboard: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
};

const LINKS = [
  { id: 'feed', href: 'feed.html', label: 'Início / Feed', icon: 'feed' },
  { id: 'materials', href: 'plataforma.html', label: 'Explorar materiais', icon: 'materials' },
  { id: 'communities', href: 'plataforma.html#com', label: 'Explorar comunidades', icon: 'communities' },
  { id: 'my-files', href: 'feed.html#my-files', label: 'Meus arquivos', icon: 'files' },
  { id: 'my-downloads', href: 'feed.html#my-downloads', label: 'Meus downloads', icon: 'downloads' },
  { id: 'my-communities', href: 'feed.html#my-communities', label: 'Minhas comunidades', icon: 'myCom' },
  { id: 'admin-communities', href: 'feed.html#admin-communities', label: 'Comunidades que administro', icon: 'adminCom' },
  { id: 'profile', href: 'profile.html', label: 'Meu perfil', icon: 'profile' },
  { id: 'settings', href: 'feedback.html', label: 'Configurações / Feedback', icon: 'settings' },
  { id: 'dashboard', href: 'admin.html', label: 'Dashboard', icon: 'dashboard', adminOnly: true },
];

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] || '')
    .join('')
    .toUpperCase();
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  sidebar?.classList.remove('open');
  backdrop?.classList.remove('show');
  document.body.classList.remove('sidebar-open');
}

function openSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  sidebar?.classList.add('open');
  backdrop?.classList.add('show');
  document.body.classList.add('sidebar-open');
}

function ensureBackdrop() {
  if (document.getElementById('sidebar-backdrop')) return;
  const el = document.createElement('div');
  el.id = 'sidebar-backdrop';
  el.className = 'sidebar-backdrop';
  el.addEventListener('click', closeSidebar);
  document.body.appendChild(el);
}

function buildSidebarHtml(active, isAdmin = false) {
  const nav = LINKS.filter((link) => !link.adminOnly || isAdmin)
    .map((link) => {
      const isActive = link.id === active ? ' active' : '';
      return `<a href="${link.href}" class="${isActive.trim()}" data-nav="${link.id}">${ICONS[link.icon]} ${link.label}</a>`;
    })
    .join('');

  return `
    <div class="brand">
      <a class="logo" href="feed.html">Estud<b>aí!</b></a>
    </div>
    <nav class="side-nav" id="side-nav">${nav}</nav>
    <div class="side-foot">
      <div class="side-user">
        <div class="av" id="side-av">?</div>
        <div class="meta">
          <strong id="side-name">…</strong>
          <span id="side-email">…</span>
        </div>
      </div>
      <button class="lnk" data-logout type="button" style="margin-top:8px;width:100%;text-align:left;padding:6px 8px">Sair da conta</button>
    </div>
  `;
}

/**
 * Inicializa a barra lateral padrão do Estudaí! em qualquer página autenticada.
 * @param {{ active?: string, user?: { name?: string, email?: string } }} opts
 */
export function initSidebar({ active = 'feed', user = null, isAdmin = false } = {}) {
  ensureBackdrop();

  let sidebar = document.getElementById('sidebar');
  if (!sidebar) {
    sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';
    sidebar.id = 'sidebar';
    const layout = document.querySelector('.layout');
    if (layout) layout.insertBefore(sidebar, layout.firstChild);
    else document.body.prepend(sidebar);
  }

  // Sempre usa o menu completo (mesma barra em todas as páginas)
  const admin = Boolean(isAdmin || user?.isAdmin);
  sidebar.innerHTML = buildSidebarHtml(active, admin);
  sidebar.dataset.active = active;

  if (user) {
    const av = document.getElementById('side-av');
    const name = document.getElementById('side-name');
    const email = document.getElementById('side-email');
    if (av) av.textContent = initials(user.name);
    if (name) name.textContent = user.name || '…';
    if (email) email.textContent = user.email || '';
  }

  // Botão hambúrguer
  document.querySelectorAll('#menu-toggle, .menu-toggle').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (sidebar.classList.contains('open')) closeSidebar();
      else openSidebar();
    });
  });

  // Clique fora (além do backdrop): qualquer clique no main fecha
  document.addEventListener('click', (e) => {
    if (!sidebar.classList.contains('open')) return;
    if (sidebar.contains(e.target)) return;
    if (e.target.closest('#menu-toggle, .menu-toggle')) return;
    closeSidebar();
  });

  // ESC fecha
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebar();
  });

  // Ao clicar em link do menu no mobile, fecha a barra
  sidebar.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', () => {
      if (window.matchMedia('(max-width: 900px)').matches) closeSidebar();
    });
  });

  // Logout
  sidebar.querySelector('[data-logout]')?.addEventListener('click', (e) => {
    e.preventDefault();
    api.auth.logout().finally(() => location.replace('index.html'));
  });

  return { openSidebar, closeSidebar, sidebar };
}

export function setSidebarUser(user) {
  if (!user) return;
  const sidebar = document.getElementById('sidebar');
  if (sidebar && user.isAdmin) {
    const active = sidebar.dataset.active || 'feed';
    sidebar.innerHTML = buildSidebarHtml(active, true);
    // re-bind logout after rebuild
    sidebar.querySelector('[data-logout]')?.addEventListener('click', (e) => {
      e.preventDefault();
      api.auth.logout().finally(() => location.replace('index.html'));
    });
    sidebar.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => {
        if (window.matchMedia('(max-width: 900px)').matches) closeSidebar();
      });
    });
  }
  const av = document.getElementById('side-av');
  const name = document.getElementById('side-name');
  const email = document.getElementById('side-email');
  if (av) av.textContent = initials(user.name);
  if (name) name.textContent = user.name || '…';
  if (email) email.textContent = user.email || '';
}
