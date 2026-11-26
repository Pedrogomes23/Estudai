import { api } from '../lib/api.js';
import { $ } from '../lib/dom.js';

const params = new URLSearchParams(location.search);
const token = (params.get('token') || '').trim();

function show(id) {
  for (const key of ['view-loading', 'view-invalid', 'view-ok']) {
    $(key).hidden = key !== id;
  }
}

function invalid(message) {
  $('invalid-msg').textContent = message;
  show('view-invalid');
}

async function start() {
  if (!token || token.length < 20 || token.length > 256) {
    invalid('Este link de confirmação é inválido. Solicite um novo link na tela de login.');
    return;
  }

  try {
    const result = await api.auth.validateEmailVerification(token);

    if (!result.valid) {
      const reasons = {
        EXPIRED: 'Este link expirou. Solicite um novo e-mail de confirmação.',
        USED: 'Este link já foi utilizado. Tente entrar com sua conta.',
        INVALID: 'Este link de confirmação não é válido. Solicite um novo.',
      };
      invalid(reasons[result.reason] || reasons.INVALID);
      return;
    }

    await api.auth.verifyEmail(token);
    show('view-ok');
  } catch {
    invalid(
      'Não foi possível confirmar seu e-mail. O link pode ter expirado ou já ter sido utilizado. Tente solicitar outro.',
    );
  }
}

start();