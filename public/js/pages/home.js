import { api } from '../lib/api.js';

/**
 * Página institucional pública.
 * Visitante sem sessão: CTAs de login/cadastro intactos.
 * Com sessão: esconde botões do topo; no hero e no rodapé deixa só o amarelo
 * apontando para a plataforma.
 */
async function start() {
  try {
    const user = await api.auth.me();
    if (!user) return;

    // Topo: remove os dois botões de login/criar conta
    document.querySelectorAll('[data-guest-cta="nav"]').forEach((el) => el.remove());

    // Hero e seção final: remove o botão contorno (azul/outline)
    document.querySelectorAll('[data-guest-cta="secondary"]').forEach((el) => el.remove());

    // Mantém só o amarelo, com texto e link para a plataforma
    document.querySelectorAll('[data-guest-cta="primary"]').forEach((el) => {
      el.href = 'feed.html';
      el.textContent = 'Ir para minha área';
    });
  } catch {
    // sem sessão — página pública normal
  }
}

start();
