import { api } from '../lib/api.js';

/**
 * Página institucional pública.
 * Visitante sem sessão: vê a landing normalmente.
 * Usuário logado: redireciona imediatamente para o feed (nunca vê esta página).
 */
async function start() {
  try {
    const user = await api.auth.me();
    if (user) {
      location.replace('/feed');
      return;
    }
  } catch {
    // sem sessão — página pública normal
  }
}

start();
