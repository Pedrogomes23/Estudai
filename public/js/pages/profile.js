import { ApiError, api } from '../lib/api.js';
import { $, escapeHtml, ICON_DOWNLOAD } from '../lib/dom.js';

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] || '')
    .join('')
    .toUpperCase();
}

function say(text) {
  const box = $('msg');
  box.textContent = text;
  box.hidden = false;
  clearTimeout(say._t);
  say._t = setTimeout(() => (box.hidden = true), 3000);
}

function handleError(err, fallback) {
  if (err instanceof ApiError && err.status === 401) return location.replace('login.html');
  say(err instanceof ApiError ? err.message : fallback);
}

async function boot() {
  try {
    const [profile, materials] = await Promise.all([
      api.profile.me(),
      api.materials.list({ mine: '1' }),
    ]);
    const u = profile.user;
    const s = profile.stats;

    $('prof-name').textContent = u.name;
    $('prof-email').textContent = u.email;
    $('prof-bio').textContent = u.bio || 'Nenhuma biografia ainda.';
    $('prof-av').textContent = initials(u.name);
    $('side-name').textContent = u.name;
    $('side-email').textContent = u.email;
    $('side-av').textContent = initials(u.name);
    $('name').value = u.name;
    $('bio').value = u.bio || '';

    $('stat-materials').textContent = s.materials;
    $('stat-downloads').textContent = s.downloads;
    $('stat-joined').textContent = s.communitiesJoined;
    $('stat-owned').textContent = s.communitiesOwned;

    const list = $('my-materials');
    if (!materials.items?.length) {
      list.innerHTML = '<div class="empty">Você ainda não enviou materiais.</div>';
    } else {
      list.innerHTML = materials.items
        .map(
          (m) => `
        <article class="mcard">
          <div>
            <span class="tag">${escapeHtml(m.category)}</span>
            <h3>${escapeHtml(m.title)}</h3>
            <div class="meta">${escapeHtml(m.discipline)} · ${m.downloads} downloads</div>
          </div>
          <div></div>
          ${m.description ? `<p class="desc">${escapeHtml(m.description)}</p>` : ''}
          <div class="acts">
            <span class="stat">${ICON_DOWNLOAD} ${m.downloads}</span>
            <button class="lnk" data-del="${m.id}">Excluir</button>
          </div>
        </article>`,
        )
        .join('');
    }
  } catch (err) {
    handleError(err, 'Não foi possível carregar o perfil.');
  }
}

$('edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('edit-err').textContent = '';
  try {
    const user = await api.profile.update({
      name: $('name').value.trim(),
      bio: $('bio').value.trim(),
    });
    $('prof-name').textContent = user.name;
    $('prof-bio').textContent = user.bio || 'Nenhuma biografia ainda.';
    $('prof-av').textContent = initials(user.name);
    $('side-name').textContent = user.name;
    $('side-av').textContent = initials(user.name);
    say('Perfil atualizado.');
  } catch (err) {
    $('edit-err').textContent = err instanceof ApiError ? err.message : 'Erro ao salvar.';
  }
});

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-logout]')) {
    e.preventDefault();
    api.auth.logout().finally(() => location.replace('index.html'));
  }
  const del = e.target.closest('[data-del]');
  if (del) {
    if (!confirm('Excluir este material?')) return;
    api.materials
      .remove(Number(del.dataset.del))
      .then(() => {
        del.closest('.mcard')?.remove();
        say('Material excluído.');
      })
      .catch((err) => handleError(err, 'Não foi possível excluir.'));
  }
});

$('menu-toggle')?.addEventListener('click', () => $('sidebar').classList.toggle('open'));

boot();
