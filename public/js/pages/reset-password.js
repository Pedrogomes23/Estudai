import { ApiError, api } from '../lib/api.js';
import { $ } from '../lib/dom.js';

const params = new URLSearchParams(location.search);
const token = (params.get('token') || '').trim();

function show(id) {
  for (const key of ['view-loading', 'view-invalid', 'view-form', 'view-ok']) {
    $(key).hidden = key !== id;
  }
}

function fail(id, message) {
  const el = $(id);
  if (!el) return !message;
  el.textContent = message || '';
  return !message;
}

function setReq(id, state) {
  const el = $(id);
  el.classList.remove('ok', 'bad');
  if (state === true) el.classList.add('ok');
  if (state === false) el.classList.add('bad');
}

function evaluate() {
  const pass = $('pass').value;
  const pass2 = $('pass2').value;
  const len = pass.length >= 8;
  const letter = /[A-Za-zÀ-ÿ]/.test(pass);
  const num = /[0-9]/.test(pass);
  const match = pass.length > 0 && pass === pass2;
  setReq('r-len', pass ? len : null);
  setReq('r-letter', pass ? letter : null);
  setReq('r-num', pass ? num : null);
  setReq('r-match', pass2 ? match : null);
  return { len, letter, num, match };
}

function togglePassword(inputId, button) {
  const input = $(inputId);
  const reveal = input.type === 'password';
  input.type = reveal ? 'text' : 'password';
  button.textContent = reveal ? 'Ocultar' : 'Mostrar';
  button.setAttribute('aria-pressed', String(reveal));
}

async function submit(event) {
  event.preventDefault();
  fail('form-e', '');
  const { len, letter, num, match } = evaluate();
  const passOk = fail(
    'pass-e',
    !len ? 'Use pelo menos 8 caracteres.' : !letter ? 'Inclua pelo menos uma letra.' : !num ? 'Inclua pelo menos um número.' : '',
  );
  const matchOk = fail('pass2-e', match ? '' : 'As senhas não coincidem.');
  if (!passOk || !matchOk) return;

  const btn = $('btn-save');
  btn.disabled = true;
  btn.textContent = 'Salvando…';
  try {
    await api.auth.resetPassword({ token, password: $('pass').value });
    show('view-ok');
  } catch (err) {
    const msg =
      err instanceof ApiError
        ? err.message
        : 'Não foi possível salvar a nova senha. Tente de novo.';
    if (err instanceof ApiError && (err.message.includes('inválido') || err.message.includes('expirou'))) {
      $('invalid-msg').textContent = msg;
      show('view-invalid');
    } else {
      fail('form-e', msg);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar nova senha';
  }
}

async function start() {
  if (!token || token.length < 20) {
    $('invalid-msg').textContent =
      'Este link de recuperação é inválido. Solicite uma nova redefinição de senha.';
    show('view-invalid');
    return;
  }

  try {
    const result = await api.auth.validateResetToken(token);
    if (!result.valid) {
      const reasons = {
        EXPIRED: 'Este link expirou (válido por 15 minutos). Solicite uma nova recuperação.',
        USED: 'Este link já foi utilizado. Solicite uma nova recuperação se ainda precisar.',
        INVALID: 'Este link de recuperação não é válido.',
      };
      $('invalid-msg').textContent = reasons[result.reason] || reasons.INVALID;
      show('view-invalid');
      return;
    }
    show('view-form');
    $('pass').focus();
  } catch {
    $('invalid-msg').textContent =
      'Não foi possível validar o link agora. Tente novamente ou solicite uma nova recuperação.';
    show('view-invalid');
  }
}

document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-toggle]');
  if (btn) togglePassword(btn.dataset.toggle, btn);
});
$('pass')?.addEventListener('input', evaluate);
$('pass2')?.addEventListener('input', evaluate);
$('f-reset')?.addEventListener('submit', submit);

start();
