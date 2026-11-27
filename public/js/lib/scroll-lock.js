/** Trava a rolagem da página de trás enquanto um modal está aberto (PC e celular). */
let locks = 0;

export function lockScroll() {
  locks += 1;
  if (locks > 1) return;
  // Compensa a barra de rolagem que some, para a página não "pular" de lado no PC.
  const gap = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.paddingRight = gap > 0 ? `${gap}px` : '';
  document.body.classList.add('scroll-locked');
}

export function unlockScroll() {
  locks = Math.max(0, locks - 1);
  if (locks > 0) return;
  document.body.classList.remove('scroll-locked');
  document.body.style.paddingRight = '';
}
