// Cambio manual de la etapa en curso: se arrastra el punto animado a otra parada de la ruta
// (horizontal en la tabla, vertical en las tarjetas móviles) o se usan las flechas del teclado.
import { h } from './dom.js';
import { LEGS, findPatient, setManualStage } from './store.js';
import { toast } from './ui.js';

const CLICK_TOLERANCE = 4;
const EDGE = 48;

let drag = null;

const center = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

function stops(container) {
  return [...container.querySelectorAll('[data-leg]')].filter((el) => !el.classList.contains('leg-skip'));
}

async function applyStage(patientId, legKey) {
  const p = findPatient(patientId);
  const leg = LEGS.find((l) => l.key === legKey);
  if (!p || !leg) return;
  const error = await setManualStage(patientId, legKey);
  toast(error ?? `${p.nombre} pasó a la etapa ${leg.short}.`, { type: error ? 'error' : 'success' });
}

function refocus(patientId) {
  const handle = [...document.querySelectorAll(`.leg-handle[data-patient="${patientId}"]`)]
    .find((el) => el.offsetParent !== null);
  handle?.focus();
}

/* ---------- Arrastre con puntero (mouse, lápiz o toque) ---------- */
// El punto mide 12 px: se acepta tomarlo con cierto margen alrededor para que sea fácil de agarrar.
const HIT_RADIUS = 18;

function handleAt(e) {
  const direct = e.target.closest?.('.leg-handle');
  if (direct) return direct;
  const near = e.target.closest?.('[data-leg]')?.querySelector('.leg-handle');
  if (!near) return null;
  const c = center(near);
  return Math.hypot(e.clientX - c.x, e.clientY - c.y) <= HIT_RADIUS ? near : null;
}

function onPointerDown(e) {
  const handle = handleAt(e);
  if (!handle || e.button !== 0) return;
  e.preventDefault();
  const container = handle.closest('tr, .route-list');
  const start = center(handle);
  drag = {
    handle,
    container,
    axis: container.matches('tr') ? 'x' : 'y',
    scroller: handle.closest('#trip-scroll'),
    patientId: handle.dataset.patient,
    from: handle.closest('[data-leg]').dataset.leg,
    start,
    pointer: { x: e.clientX, y: e.clientY },
    moved: false,
    target: null,
    ghost: null,
  };
  handle.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
  if (!drag || !drag.handle.hasPointerCapture(e.pointerId)) return;
  const dx = e.clientX - drag.pointer.x;
  const dy = e.clientY - drag.pointer.y;
  if (!drag.moved && Math.hypot(dx, dy) < CLICK_TOLERANCE) return;

  if (!drag.moved) {
    drag.moved = true;
    drag.ghost = h('span', { class: 'leg-ghost', 'aria-hidden': 'true' });
    document.body.append(drag.ghost);
    document.body.classList.add('is-dragging-stage');
    drag.handle.classList.add('is-dragging');
  }

  // Desplaza la tabla si el puntero se acerca a los bordes.
  // La columna del paciente es fija (sticky), así que el borde izquierdo útil empieza después de ella.
  const visibleLeft = () => {
    const r = drag.scroller.getBoundingClientRect();
    return r.left + (drag.container.querySelector('.col-patient')?.offsetWidth ?? 0);
  };
  if (drag.scroller) {
    const r = drag.scroller.getBoundingClientRect();
    if (e.clientX > r.right - EDGE) drag.scroller.scrollLeft += 14;
    else if (e.clientX < visibleLeft() + EDGE) drag.scroller.scrollLeft -= 14;
  }

  const candidates = stops(drag.container);
  if (!candidates.length) return;
  const points = candidates.map((el) => ({ el, ...center(el.querySelector('.leg-dot')) }));
  const along = drag.axis === 'x' ? 'x' : 'y';
  const first = points[0][along];
  const last = points[points.length - 1][along];
  let pos = clamp(drag.axis === 'x' ? e.clientX : e.clientY, Math.min(first, last), Math.max(first, last));
  if (drag.scroller && drag.axis === 'x') {
    pos = clamp(pos, visibleLeft(), drag.scroller.getBoundingClientRect().right);
  }
  const fixed = drag.axis === 'x' ? points[0].y : points[0].x;
  const x = drag.axis === 'x' ? pos : fixed;
  const y = drag.axis === 'x' ? fixed : pos;
  drag.ghost.style.left = `${x}px`;
  drag.ghost.style.top = `${y}px`;

  const nearest = points.reduce((a, b) => (Math.abs(b[along] - pos) < Math.abs(a[along] - pos) ? b : a));
  if (drag.target !== nearest.el) {
    drag.target?.classList.remove('leg-drop-target');
    drag.target = nearest.el;
    drag.target.classList.add('leg-drop-target');
  }
}

function endDrag(commit) {
  if (!drag) return;
  const { moved, target, from, patientId, handle } = drag;
  const idle = handle.dataset.idle === 'true';
  drag.ghost?.remove();
  drag.target?.classList.remove('leg-drop-target');
  drag.handle.classList.remove('is-dragging');
  document.body.classList.remove('is-dragging-stage');
  drag = null;
  if (!commit) return;
  // Un clic (sin arrastrar) en el punto punteado inicia el viaje en esa parada.
  if (!moved && idle) applyStage(patientId, from);
  else if (moved && target && (idle || target.dataset.leg !== from)) applyStage(patientId, target.dataset.leg);
}

/* ---------- Teclado: flechas para la etapa anterior o siguiente ---------- */
function onKeyDown(e) {
  if (e.key === 'Escape' && drag) {
    endDrag(false);
    return;
  }
  const handle = e.target.closest?.('.leg-handle');
  if (!handle) return;
  const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
  const idle = handle.dataset.idle === 'true';
  if (idle && (step || e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    const patientId = handle.dataset.patient;
    applyStage(patientId, handle.closest('[data-leg]').dataset.leg).then(() => refocus(patientId));
    return;
  }
  if (!step) return;
  e.preventDefault();
  const list = stops(handle.closest('tr, .route-list'));
  const i = list.indexOf(handle.closest('[data-leg]'));
  const next = list[i + step];
  if (!next) return;
  const patientId = handle.dataset.patient;
  applyStage(patientId, next.dataset.leg).then(() => refocus(patientId));
}

export function setupStageDrag() {
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', () => endDrag(true));
  document.addEventListener('pointercancel', () => endDrag(false));
  document.addEventListener('keydown', onKeyDown);
}
