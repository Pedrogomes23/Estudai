import { ApiError, api } from '../lib/api.js';
import { $, escapeHtml, ICON_DOWNLOAD } from '../lib/dom.js';
import { initSidebar, setSidebarUser } from '../lib/sidebar.js';

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] || '')
    .join('')
    .toUpperCase();
}

/** Preenche um .av com foto ou iniciais. */
function paintAvatar(el, { name, avatarUrl }) {
  if (!el) return;
  if (avatarUrl) {
    el.classList.add('has-photo');
    el.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="">`;
  } else {
    el.classList.remove('has-photo');
    el.textContent = initials(name);
  }
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
  initSidebar({ active: 'profile' });

  try {
    const [profile, materials] = await Promise.all([api.profile.me(), api.materials.list({ mine: '1' })]);
    const u = profile.user;
    const s = profile.stats;
    // Reconstrói a sidebar com o botão Dashboard quando a conta é admin.
    setSidebarUser(u);

    $('prof-name').textContent = u.name;
    $('prof-email').textContent = u.email;
    $('prof-bio').textContent = u.bio || 'Nenhuma biografia ainda.';
    $('side-name').textContent = u.name;
    $('side-email').textContent = u.email;
    paintAvatar($('side-av'), u);
    paintAvatar($('prof-av'), u);
    paintAvatar($('edit-av-preview'), u);
    $('avatar-remove').hidden = !u.avatarUrl;
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
    $('side-name').textContent = user.name;
    paintAvatar($('side-av'), user);
    paintAvatar($('prof-av'), user);
    paintAvatar($('edit-av-preview'), user);
    say('Perfil atualizado.');
  } catch (err) {
    $('edit-err').textContent = err instanceof ApiError ? err.message : 'Erro ao salvar.';
  }
});

$('avatar-input')?.addEventListener('change', async () => {
  const file = $('avatar-input').files?.[0];
  $('avatar-err').textContent = '';
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) {
    $('avatar-err').textContent = 'A foto deve ter no máximo 4 MB.';
    $('avatar-input').value = '';
    return;
  }
  try {
    const { user } = await api.profile.uploadAvatar(file);
    const name = $('name').value.trim() || $('prof-name').textContent;
    const data = { name, avatarUrl: user.avatarUrl };
    paintAvatar($('side-av'), data);
    paintAvatar($('prof-av'), data);
    paintAvatar($('edit-av-preview'), data);
    $('avatar-remove').hidden = false;
    say('Foto atualizada.');
  } catch (err) {
    $('avatar-err').textContent = err instanceof ApiError ? err.message : 'Não foi possível enviar a foto.';
  } finally {
    $('avatar-input').value = '';
  }
});

$('avatar-remove')?.addEventListener('click', async () => {
  $('avatar-err').textContent = '';
  try {
    await api.profile.removeAvatar();
    const name = $('name').value.trim() || $('prof-name').textContent;
    const data = { name, avatarUrl: null };
    paintAvatar($('side-av'), data);
    paintAvatar($('prof-av'), data);
    paintAvatar($('edit-av-preview'), data);
    $('avatar-remove').hidden = true;
    say('Foto removida.');
  } catch (err) {
    $('avatar-err').textContent = err instanceof ApiError ? err.message : 'Não foi possível remover.';
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

boot();
