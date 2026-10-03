// Notificaciones y confirmaciones con el estilo del sitio (sin alert/confirm nativos).
import { h, icon } from './dom.js';

const TOAST_MS = 4200;

export function toast(message, { type = 'success' } = {}) {
  const region = document.getElementById('toasts');
  const item = h('div', { class: `toast${type === 'error' ? ' toast-error' : ''}` },
    icon(type === 'error' ? 'alert' : 'check'),
    h('p', { class: 'text-sm' }, message),
  );
  region.append(item);
  const dismiss = () => {
    item.classList.add('is-leaving');
    item.addEventListener('animationend', () => item.remove(), { once: true });
    setTimeout(() => item.remove(), 400); // por si la animación no corre (pestaña oculta o movimiento reducido)
  };
  setTimeout(dismiss, type === 'error' ? TOAST_MS * 1.5 : TOAST_MS);
}

/**
 * Muestra un diálogo de confirmación y resuelve true si el usuario confirma.
 */
export function confirmDialog({ title, text, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar' }) {
  const dialog = document.getElementById('confirm');
  const okBtn = dialog.querySelector('#confirm-ok');
  const cancelBtn = dialog.querySelector('#confirm-cancel');
  dialog.querySelector('#confirm-title').textContent = title;
  dialog.querySelector('#confirm-text').textContent = text;
  okBtn.textContent = confirmLabel;
  cancelBtn.textContent = cancelLabel;

  // Se resuelve desde los botones y la tecla Esc (el evento "close" se retrasa en pestañas en segundo plano).
  return new Promise((resolve) => {
    const finish = (value) => (e) => {
      e.preventDefault();
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
      dialog.close(value ? 'ok' : 'cancel');
      resolve(value);
    };
    const onOk = finish(true);
    const onCancel = finish(false);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
    cancelBtn.focus();
  });
}

// Los errores no controlados también se muestran como notificación.
export function installErrorHandlers() {
  const report = () => toast('Ocurrió un error inesperado. Recargá la página e intentá de nuevo.', { type: 'error' });
  window.addEventListener('error', report);
  window.addEventListener('unhandledrejection', report);
}
