import { ApiError, api } from '../lib/api.js';
import { $ } from '../lib/dom.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(id, message) {
  const el = $(id);
  if (!el) return !message;
  el.textContent = message || '';
  return !message;
}

async function submit(event) {
  event.preventDefault();
  const email = $('email').value.trim();
  const emailOk = fail(
    'email-e',
    !email ? 'Digite seu e-mail.' : !EMAIL_RE.test(email) ? 'Esse e-mail não parece válido.' : '',
  );
  fail('form-e', '');
  if (!emailOk) {
    $('email').focus();
    return;
  }

  const btn = $('btn-send');
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  try {
    await api.auth.forgotPassword({ email });
    $('view-form').hidden = true;
    $('view-sent').hidden = false;
  } catch (err) {
    const msg =
      err instanceof ApiError
        ? err.message
        : 'Não foi possível enviar a solicitação. Tente de novo.';
    fail('form-e', msg);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar link de recuperação';
  }
}

$('f-forgot').addEventListener('submit', submit);
$('email').focus();
