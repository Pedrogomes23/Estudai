let activeDialog = null;

export function confirmDialog({
  title = 'Confirmar exclusão?',
  message = 'Tem certeza de que deseja continuar?',
  confirmText = 'Excluir',
} = {}) {
  if (activeDialog) return activeDialog;

  const previousFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'ed-confirm-overlay';

  const dialog = document.createElement('section');
  dialog.className = 'ed-confirm-dialog';
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'ed-confirm-title');
  dialog.setAttribute('aria-describedby', 'ed-confirm-message');

  const icon = document.createElement('div');
  icon.className = 'ed-confirm-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '!';

  const heading = document.createElement('h2');
  heading.id = 'ed-confirm-title';
  heading.textContent = title;

  const description = document.createElement('p');
  description.id = 'ed-confirm-message';
  description.textContent = message;

  const actions = document.createElement('div');
  actions.className = 'ed-confirm-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'ed-confirm-cancel';
  cancel.textContent = 'Cancelar';

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'ed-confirm-delete';
  confirm.textContent = confirmText;

  actions.append(cancel, confirm);
  dialog.append(icon, heading, description, actions);
  overlay.appendChild(dialog);

  let settle;
  const result = new Promise((resolve) => {
    settle = resolve;
  });
  activeDialog = result;

  function close(confirmed) {
    if (!overlay.isConnected) return;
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
    activeDialog = null;
    if (previousFocus?.isConnected) previousFocus.focus();
    settle(confirmed);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(false);
      return;
    }
    if (event.key !== 'Tab') return;

    if (event.shiftKey && document.activeElement === cancel) {
      event.preventDefault();
      confirm.focus();
    } else if (!event.shiftKey && document.activeElement === confirm) {
      event.preventDefault();
      cancel.focus();
    }
  }

  cancel.addEventListener('click', () => close(false));
  confirm.addEventListener('click', () => close(true));
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close(false);
  });

  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => cancel.focus());

  return result;
}
