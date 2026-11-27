import { api } from '../lib/api.js';
import { $ } from '../lib/dom.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- Interface do formulário ---------- */

function authTab(kind) {
  $('f-in').hidden = kind !== 'in';
  $('f-up').hidden = kind !== 'up';
  $('t-in').setAttribute('aria-selected', String(kind === 'in'));
  $('t-up').setAttribute('aria-selected', String(kind === 'up'));
  const ok = $('ok');
  if (ok) ok.textContent = '';
  (kind === 'in' ? $('li-email') : $('su-nome')).focus();
}

function togglePassword(inputId, button) {
  const input = $(inputId);
  const reveal = input.type === 'password';
  input.type = reveal ? 'text' : 'password';
  button.textContent = reveal ? 'Ocultar' : 'Mostrar';
  button.setAttribute('aria-pressed', String(reveal));
}

/** Mostra (ou limpa, se `message` vazio) o erro de um campo. Retorna true quando o campo está válido. */
function fail(id, message) {
  $(`${id}-e`).textContent = message || '';
  if (message) $(id).setAttribute('aria-invalid', 'true');
  else $(id).removeAttribute('aria-invalid');
  return !message;
}

function checkEmail(id) {
  const value = $(id).value.trim();
  if (!value) return fail(id, 'Digite seu e-mail.');
  if (!EMAIL_RE.test(value)) return fail(id, 'Esse e-mail não parece válido. Confira se tem @ e domínio.');
  return fail(id, '');
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

/* ---------- Ações ---------- */

function showVerificationNotice(email, message) {
  const container = $('ok');
  if (!container) return;

  container.replaceChildren();

  const description = document.createElement('p');
  description.textContent = message;
  container.append(description);

  const form = document.createElement('form');
  form.className = 'verify-resend';
  form.noValidate = true;

  const field = document.createElement('div');
  field.className = 'fg';

  const label = document.createElement('label');
  label.textContent = 'Reenviar confirmação para:';
  label.htmlFor = 'verify-resend-email';

  const input = document.createElement('input');
  input.id = 'verify-resend-email';
  input.type = 'email';
  input.autocomplete = 'email';
  input.required = true;
  input.value = email || '';
  input.setAttribute('aria-label', 'E-mail para reenvio');

  const button = document.createElement('button');
  button.type = 'submit';
  button.className = 'btn';
  button.textContent = 'Reenviar e-mail';

  const status = document.createElement('p');
  status.className = 'err';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  field.append(label, input);
  form.append(field, button, status);
  container.append(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const address = input.value.trim().toLowerCase();

    if (!EMAIL_RE.test(address)) {
      status.textContent = 'Digite um endereço de e-mail válido.';
      input.focus();
      return;
    }

    button.disabled = true;
    button.textContent = 'Enviando...';

    try {
      await api.auth.resendVerification({ email: address });
      status.textContent =
        'Se houver uma conta pendente para esse e-mail, enviaremos um novo link. Confira também o spam.';
    } catch {
      status.textContent = 'Não foi possível solicitar o reenvio agora. Tente novamente em instantes.';
    } finally {
      button.disabled = false;
      button.textContent = 'Reenviar e-mail';
    }
  });
}

async function submitLogin(event) {
  event.preventDefault();
  const ok = $('ok');
  if (ok) ok.replaceChildren();

  const emailOk = checkEmail('li-email');
  const passOk = fail('li-pass', $('li-pass').value ? '' : 'Digite sua senha.');
  if (!emailOk || !passOk) {
    (!emailOk ? $('li-email') : $('li-pass')).focus();
    return;
  }

  const form = event.target;
  const button = form.querySelector('.btn');
  setBusy(button, true, 'Entrando...');

  try {
    await api.auth.login({
      email: $('li-email').value.trim(),
      password: $('li-pass').value,
      remember: $('li-rem').checked,
    });
    form.reset();
    location.replace('feed.html');
  } catch (err) {
    if (err.code === 'EMAIL_NOT_VERIFIED') {
      showVerificationNotice(
        $('li-email').value.trim(),
        err.message || 'Confirme seu e-mail antes de entrar. Confira sua caixa de entrada e o spam.',
      );
    } else {
      fail('li-pass', err.message || 'Não foi possível entrar. Confira seus dados.');
      $('li-pass').focus();
    }
  } finally {
    setBusy(button, false, 'Entrar');
  }
}

async function submitSignup(event) {
  event.preventDefault();

  const password = $('su-pass').value;
  const nameOk = fail('su-nome', $('su-nome').value.trim() ? '' : 'Digite seu nome.');
  const emailOk = checkEmail('su-email');
  const passOk = fail(
    'su-pass',
    !password ? 'Crie uma senha.' : password.length < 8 ? 'Use pelo menos 8 caracteres.' : '',
  );

  if (!nameOk || !emailOk || !passOk) {
    (!nameOk ? $('su-nome') : !emailOk ? $('su-email') : $('su-pass')).focus();
    return;
  }

  const form = event.target;
  const button = form.querySelector('.btn');
  const email = $('su-email').value.trim().toLowerCase();

  setBusy(button, true, 'Criando...');

  try {
    await api.auth.register({
      name: $('su-nome').value.trim(),
      email,
      password,
    });

    form.reset();
    authTab('in');
    $('li-email').value = email;
    showVerificationNotice(
      email,
      'Cadastro criado! Enviamos um link de confirmação para seu e-mail. Confirme o endereço antes de entrar no Estudaí! Se não encontrar, verifique também a caixa de spam ou lixo eletrônico.',
    );
  } catch (err) {
    if (err.code === 'EMAIL_TAKEN' || err.fields) {
      const target =
        err.code === 'EMAIL_TAKEN'
          ? 'su-email'
          : ({ name: 'su-nome', email: 'su-email' }[Object.keys(err.fields ?? {})[0]] ?? 'su-pass');

      fail(target, err.message);
      $(target).focus();
    } else if (err.code === 'MAIL_SEND_FAILED') {
      form.reset();
      authTab('in');
      $('li-email').value = email;
      showVerificationNotice(
        email,
        'Sua conta foi criada, mas não conseguimos enviar o e-mail de confirmação. Você pode solicitar outro envio abaixo. Depois, confira a caixa de entrada e o spam.',
      );
    } else {
      fail('su-pass', err.message || 'Não foi possível concluir o cadastro. Tente novamente.');
      $('su-pass').focus();
    }
  } finally {
    setBusy(button, false, 'Criar conta');
  }
}

export async function initAuth() {
  document.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-auth-tab]');
    if (tab) authTab(tab.dataset.authTab);
    const eye = event.target.closest('[data-toggle]');
    if (eye) togglePassword(eye.dataset.toggle, eye);
  });

  const formIn = $('f-in');
  const formUp = $('f-up');
  if (formIn) formIn.addEventListener('submit', submitLogin);
  if (formUp) formUp.addEventListener('submit', submitSignup);

  const forgot = $('forgot');
  if (forgot) {
    forgot.addEventListener('click', (event) => {
      event.preventDefault();
      location.href = 'forgot-password.html';
    });
  }

  // Aba inicial via ?tab=up
  const params = new URLSearchParams(location.search);
  if (params.get('tab') === 'up') authTab('up');

  // Quem já está conectado vai direto para a plataforma
  try {
    await api.auth.me();
    location.replace('feed.html');
  } catch {
    // sem sessão: permanece na tela de login
  }
}