/**
 * Trava a rolagem da página de trás enquanto um modal está aberto (PC e celular).
 * Não depende só do CSS: mexe direto no <html>/<body> e barra roda do mouse e toque fora do modal.
 */
let locks = 0;
let saved = null;

/** Só deixa rolar dentro da própria janelinha, e só se ela tiver o que rolar. */
function guard(event) {
  const box = event.target?.closest?.('.notif-modal-card, .ed-confirm-dialog');
  if (box && box.scrollHeight > box.clientHeight + 1) return;
  if (event.cancelable) event.preventDefault();
}

export function lockScroll() {
  locks += 1;
  if (locks > 1) return;
  const root = document.documentElement;
  const body = document.body;
  // Compensa a barra de rolagem que some, para a página não "pular" de lado no PC.
  const gap = window.innerWidth - root.clientWidth;
  saved = {
    rootOverflow: root.style.overflow,
    bodyOverflow: body.style.overflow,
    bodyPadding: body.style.paddingRight,
  };
  root.style.overflow = 'hidden';
  body.style.overflow = 'hidden';
  if (gap > 0) body.style.paddingRight = `${gap}px`;
  body.classList.add('scroll-locked');
  document.addEventListener('wheel', guard, { passive: false });
  document.addEventListener('touchmove', guard, { passive: false });
}

export function unlockScroll() {
  locks = Math.max(0, locks - 1);
  if (locks > 0) return;
  const root = document.documentElement;
  const body = document.body;
  document.removeEventListener('wheel', guard);
  document.removeEventListener('touchmove', guard);
  body.classList.remove('scroll-locked');
  if (saved) {
    root.style.overflow = saved.rootOverflow;
    body.style.overflow = saved.bodyOverflow;
    body.style.paddingRight = saved.bodyPadding;
    saved = null;
  }
}
