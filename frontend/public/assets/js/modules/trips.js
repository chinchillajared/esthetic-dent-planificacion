// Vista "Viajes": métricas, tabla de itinerarios (escritorio) y tarjetas (móvil).
import { flightStatusLine } from './flight-status.js';
import { formatDay, formatDayTime, formatMoney, formatPrice, h, icon, parseDate } from './dom.js';
import {
  LEGS, applicableLegs, currentStage, isManualStage, legStatus, pendingBalance, sedeById, sedeColor, sedes,
  archLabel, paymentTrips, setManualStage, tratamientoByName, tripPhase, usesArches,
} from './store.js';
import { toast } from './ui.js';

const STATUS_CLASS = { confirmado: '', pendiente: 'leg-pending', 'no-aplica': 'leg-skip' };

export function sedePill(sedeId) {
  const sede = sedeById(sedeId);
  return h('span', { class: 'pill pill-plain pill-sede' }, icon('pin', 'icon-sm'), sede.nombre);
}

function nights(p) {
  const a = parseDate(p.hotel?.checkin);
  const b = parseDate(p.hotel?.checkout);
  if (!a || !b) return null;
  return Math.round((b - a) / 86_400_000);
}

/** Texto de cada parada: { title, meta } */
function legContent(p, key, status) {
  if (status === 'no-aplica') return { title: 'No aplica', meta: 'Traslado terrestre' };
  const when = (v) => formatDayTime(v) || 'Por confirmar';
  switch (key) {
    case 'llegada':
    case 'nacionalIda':
    case 'nacionalRegreso':
    case 'salida':
      return { title: p[key].ruta || 'Ruta por definir', meta: when(p[key].fecha) };
    case 'pickup':
      return { title: 'Aeropuerto → hotel', meta: when(p.pickup.fecha) };
    case 'hotel': {
      const n = nights(p);
      return {
        title: p.hotel.nombre || 'Hotel por definir',
        meta: status === 'confirmado'
          ? `${formatDay(p.hotel.checkin)}${n ? ` · ${n} ${n === 1 ? 'noche' : 'noches'}` : ''}`
          : 'Por confirmar',
      };
    }
    default:
      return { title: '', meta: '' };
  }
}

function liveStatus(p, stage) {
  const manual = isManualStage(p);
  return h('span', { class: 'inline-flex flex-wrap items-center gap-1.5' },
    h('span', { class: 'pill pill-live' }, `En curso · ${stage.short}${manual ? ' · manual' : ''}`),
    manual
      ? h('button', {
        type: 'button',
        class: 'link-action text-xs',
        title: 'Volver a calcular la etapa según las fechas del itinerario',
        onclick: async () => {
          const error = await setManualStage(p.id, null);
          toast(error ?? `${p.nombre} volvió a la etapa automática.`, { type: error ? 'error' : 'success' });
        },
      }, 'Automática')
      : null,
  );
}

// El punto de la etapa en curso es un control: se arrastra a otra parada o se mueve con las flechas.
function stageHandle(p, leg) {
  return h('button', {
    type: 'button',
    class: 'leg-dot leg-handle',
    dataset: { patient: p.id },
    title: 'Arrastrá el punto a otra etapa para cambiarla',
    'aria-label': `Etapa en curso de ${p.nombre}: ${leg.short}. Usá las flechas para pasar a la etapa anterior o siguiente.`,
  });
}

// Sin etapa en curso, un punto punteado (en la primera parada, o en la última si el viaje terminó)
// permite marcar a mano el inicio: clic, Enter o arrastrarlo a la etapa deseada.
function idleHandle(p, leg, phase) {
  const accion = phase === 'finalizado' ? 'reabrir el viaje' : 'iniciar el viaje';
  return h('button', {
    type: 'button',
    class: 'leg-dot leg-handle leg-handle-idle',
    dataset: { patient: p.id, idle: 'true' },
    title: `Hacé clic o arrastrá el punto para ${accion}`,
    'aria-label': `Viaje de ${p.nombre} ${phase === 'finalizado' ? 'finalizado' : 'por iniciar'}. Presioná Enter para marcar ${leg.short} como etapa en curso, o arrastrá el punto a otra etapa.`,
  });
}

/** Qué dibujar en cada parada: el punto en curso, el punto para iniciar o un punto normal. */
function stageState(p) {
  const cur = currentStage(p);
  if (cur) return { cur, phase: 'en-curso', anchor: cur.key };
  const phase = tripPhase(p);
  const legs = applicableLegs(p);
  const anchor = (phase === 'finalizado' ? legs[legs.length - 1] : legs[0])?.key;
  return { cur: null, phase, anchor };
}

function legDot(p, leg, st) {
  if (st.anchor !== leg.key) return h('span', { class: 'leg-dot', 'aria-hidden': 'true' });
  return st.cur ? stageHandle(p, leg) : idleHandle(p, leg, st.phase);
}

function phasePill(p, st) {
  if (st.cur) return liveStatus(p, st.cur);
  return h('span', { class: 'pill pill-plain bg-paper text-muted' }, st.phase === 'finalizado' ? 'Viaje finalizado' : 'Por iniciar');
}

/* ---------- Transporte / Tratamiento por paciente ---------- */
// Cada paciente puede mostrar su itinerario (transporte) o el detalle del tratamiento y pagos,
// así no hace falta desplazarse a la derecha. La elección se recuerda mientras la página esté abierta.
const rowView = new Map();
const viewOf = (p) => rowView.get(p.id) ?? 'transporte';

// Al cambiar de vista se actualizan juntas la fila (escritorio) y la tarjeta (móvil) del paciente.
function refreshPatient(p, onOpen) {
  const row = document.querySelector(`#trip-rows tr[data-patient="${p.id}"]`);
  const card = document.querySelector(`#trip-cards li[data-patient="${p.id}"]`);
  const freshRow = row && tableRow(p, 0, onOpen, false);
  const freshCard = card && mobileCard(p, onOpen);
  row?.replaceWith(freshRow);
  card?.replaceWith(freshCard);
  [freshRow, freshCard].find((el) => el?.offsetParent !== null)
    ?.querySelector('.view-toggle [aria-pressed="true"]')?.focus();
}

function viewToggle(p, onChange, vertical) {
  const current = viewOf(p);
  const option = (value, label, iconName) => h('button', {
    type: 'button',
    class: 'view-toggle-btn',
    'aria-pressed': String(current === value),
    onclick: () => {
      if (viewOf(p) === value) return;
      rowView.set(p.id, value);
      onChange();
    },
  }, icon(iconName, 'icon-sm'), label);
  return h('div', { class: `view-toggle ${vertical ? 'is-vertical' : ''}`, role: 'group', 'aria-label': `Detalle de ${p.nombre}` },
    option('transporte', 'Transporte', 'plane'),
    option('tratamiento', 'Tratamiento', 'tooth'),
  );
}

const block = (label, ...children) => h('div', { class: 'min-w-0' }, h('p', { class: 'eyebrow' }, label), ...children);

function paymentBlock(label, pago) {
  const paid = pago.estado === 'pagado';
  return block(label,
    h('p', { class: 'mt-1 font-display font-bold' }, formatMoney(pago.monto)),
    h('span', { class: `pill mt-1 ${paid ? '' : 'pill-pending'}` }, paid ? 'Pagado' : 'Pendiente'),
  );
}

function treatmentDetails(p, onOpen, compact) {
  const trat = tratamientoByName(p.tratamiento);
  const total = Number(p.pagos.total) || 0;
  const balance = pendingBalance(p);
  const paid = Math.max(0, total - balance);
  const pct = total ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  const fill = h('span');
  fill.style.width = `${pct}%`;
  const vigente = p.seguro?.estado === 'vigente';
  const arcos = usesArches(p) && p.arcos ? archLabel(p.arcos) : null;

  return h('div', { class: `treatment-panel ${compact ? 'is-compact' : ''}` },
    block('Tratamiento',
      h('p', { class: 'mt-1 font-display font-bold' }, p.tratamiento || 'Por definir'),
      h('p', { class: 'leg-meta' }, [arcos, trat ? `Lista ${formatPrice(trat.precio, trat.moneda)}` : null].filter(Boolean).join(' · ') || 'Sin precio de lista'),
    ),
    ...(paymentTrips(p) === 1
      ? [paymentBlock('Pago único', p.pagos.viaje1)]
      : [paymentBlock('Viaje 1', p.pagos.viaje1), paymentBlock('Viaje 2', p.pagos.viaje2)]),
    block('Seguro',
      h('span', { class: `pill mt-1 ${vigente ? '' : 'pill-pending'}` }, vigente ? 'Vigente' : 'Pendiente'),
      h('p', { class: 'leg-meta mt-1' }, p.seguro?.aseguradora || 'Sin aseguradora'),
    ),
    block('Total',
      h('p', { class: 'mt-1 font-display font-bold' }, formatMoney(total)),
      h('div', { class: 'pay-bar mt-1.5', role: 'img', 'aria-label': `Pagado ${pct} %` }, fill),
      h('p', { class: `mt-1 text-[0.8125rem] ${balance ? 'text-alert' : 'text-muted'}` },
        balance ? `Pendiente ${formatMoney(balance)}` : 'Pagado por completo'),
    ),
    h('div', { class: 'treatment-action' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => onOpen(p.id), 'aria-label': `Abrir ficha de ${p.nombre}` },
        'Abrir ficha', icon('arrow-right', 'icon-sm')),
    ),
  );
}

function tableRow(p, index, onOpen, animate = true) {
  const open = () => onOpen(p.id);
  const st = stageState(p);
  const { cur } = st;
  const rerender = () => refreshPatient(p, onOpen);

  const legs = LEGS.map((leg, i) => {
    const status = legStatus(p, leg.key);
    const { title, meta } = legContent(p, leg.key, status);
    const live = cur?.key === leg.key;
    return h('td', { class: `leg ${STATUS_CLASS[status]} ${live ? 'leg-current' : ''} ${i === 0 ? 'col-group-start' : ''} ${i === LEGS.length - 1 ? 'leg-end' : ''}`, dataset: { leg: leg.key } },
      h('div', { class: 'leg-track' }, legDot(p, leg, st)),
      h('p', { class: 'leg-title' }, title),
      h('p', { class: 'leg-meta' }, meta),
      status === 'no-aplica' ? null : flightStatusLine(p, leg.key),
    );
  });

  const row = h('tr', { class: animate ? 'animate-fade-up' : '', dataset: { patient: p.id } },
    h('th', { scope: 'row', class: 'col-patient font-normal' },
      h('div', { class: 'flex flex-col gap-2.5 2xl:flex-row 2xl:items-start 2xl:gap-3' },
        h('div', { class: 'min-w-0 flex-1' },
          h('button', { type: 'button', class: 'block max-w-full truncate font-display text-[0.9375rem] font-bold text-deep hover:text-azure', title: p.nombre, onclick: open }, p.nombre),
          h('p', { class: 'mt-0.5 text-[0.8125rem] text-muted' }, p.pais),
          h('div', { class: 'mt-2 flex flex-wrap gap-1.5' }, sedePill(p.sede), phasePill(p, st)),
        ),
        viewToggle(p, rerender, true),
      ),
    ),
    viewOf(p) === 'tratamiento'
      ? h('td', { colspan: String(LEGS.length), class: 'col-group-start treatment-cell' }, treatmentDetails(p, onOpen, false))
      : legs,
  );
  if (animate) row.style.animationDelay = `${Math.min(index, 10) * 35}ms`;
  return row;
}

function mobileCard(p, onOpen) {
  const balance = pendingBalance(p);
  const st = stageState(p);
  const { cur } = st;
  const rerender = () => refreshPatient(p, onOpen);
  const transporte = viewOf(p) === 'transporte';

  return h('li', { class: 'card p-4', dataset: { patient: p.id } },
    h('div', { class: 'flex items-start justify-between gap-3' },
      h('div', { class: 'min-w-0' },
        h('h2', { class: 'text-base font-bold' }, p.nombre),
        h('p', { class: 'text-[0.8125rem] text-muted' }, `${p.tratamiento} · ${p.pais}`),
        h('div', { class: 'mt-2' }, phasePill(p, st)),
      ),
      sedePill(p.sede),
    ),
    h('div', { class: 'mt-3' }, viewToggle(p, rerender, false)),
    transporte
      ? h('ol', { class: 'route-list mt-4' },
        LEGS.map((leg) => {
          const status = legStatus(p, leg.key);
          const { title, meta } = legContent(p, leg.key, status);
          const live = cur?.key === leg.key;
          return h('li', { class: `route-stop ${STATUS_CLASS[status]} ${live ? 'leg-current' : ''}`, dataset: { leg: leg.key } },
            legDot(p, leg, st),
            h('p', { class: 'eyebrow' }, leg.label),
            h('p', { class: 'leg-title' }, title),
            h('p', { class: 'leg-meta' }, meta),
            status === 'no-aplica' ? null : flightStatusLine(p, leg.key),
          );
        }),
      )
      : h('div', { class: 'mt-4' }, treatmentDetails(p, onOpen, true)),
    transporte
      ? h('div', { class: 'mt-4 flex items-center justify-between gap-3 border-t border-line pt-3' },
        h('div', {},
          h('p', { class: 'font-display font-bold' }, formatMoney(p.pagos.total)),
          h('p', { class: `text-[0.8125rem] ${balance ? 'text-alert' : 'text-muted'}` },
            balance ? `Pendiente ${formatMoney(balance)}` : 'Pagado por completo'),
        ),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => onOpen(p.id) }, 'Abrir ficha', icon('arrow-right', 'icon-sm')),
      )
      : null,
  );
}

function statCard({ label, value, hint, color, extra }) {
  return h('li', { class: 'card stat' },
    h('p', { class: 'eyebrow flex items-center gap-2' }, h('span', { class: 'stat-dot', dataset: { color } }), label),
    h('p', { class: 'stat-value' }, value),
    hint ? h('p', { class: 'stat-hint' }, hint) : null,
    extra ?? null,
  );
}

function sedeBar(list) {
  const counts = sedes().map((s) => ({ ...s, color: sedeColor(s.id), n: list.filter((p) => p.sede === s.id).length }));
  const bar = h('div', { class: 'sede-bar mt-1', role: 'img', 'aria-label': counts.map((c) => `${c.nombre}: ${c.n}`).join(', ') },
    counts.filter((c) => c.n).map((c) => {
      const seg = h('span');
      seg.style.flexGrow = String(c.n);
      seg.style.background = c.color;
      return seg;
    }),
  );
  const legend = h('ul', { class: 'flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted', 'aria-hidden': 'true' },
    counts.filter((c) => c.n).map((c) => {
      const dot = h('span', { class: 'stat-dot size-2' });
      dot.style.background = c.color;
      return h('li', { class: 'flex items-center gap-1.5' }, dot, `${c.nombre} ${c.n}`);
    }),
  );
  return h('div', { class: 'grid gap-2' }, bar, legend);
}

export function renderStats(list) {
  const intl = list.flatMap((p) => [p.llegada, p.salida]).filter((l) => l?.ruta);
  const intlPending = intl.filter((l) => !l.fecha).length;
  const nac = list.flatMap((p) => ['nacionalIda', 'nacionalRegreso'].map((k) => legStatus(p, k))).filter((s) => s !== 'no-aplica');
  const nacPending = nac.filter((s) => s === 'pendiente').length;
  const total = list.reduce((sum, p) => sum + (Number(p.pagos.total) || 0), 0);
  const pending = list.reduce((sum, p) => sum + pendingBalance(p), 0);

  const cards = [
    { label: 'Pacientes en esta vista', value: String(list.length), color: 'ink', extra: list.length ? sedeBar(list) : null },
    { label: 'Vuelos internacionales', value: String(intl.length), color: 'azure', hint: intlPending ? `${intlPending} por confirmar` : 'Todos confirmados' },
    { label: 'Vuelos nacionales', value: String(nac.length), color: 'sky', hint: nacPending ? `${nacPending} por confirmar` : 'Todos confirmados' },
    { label: 'Total de tratamientos', value: formatMoney(total), color: 'mist', hint: pending ? `${formatMoney(pending)} pendiente de cobro` : 'Sin saldos pendientes' },
  ];
  const ul = document.getElementById('trip-stats');
  ul.replaceChildren(...cards.map(statCard));
  ul.querySelectorAll('.stat-dot[data-color]').forEach((dot) => {
    dot.style.background = `var(--color-${dot.dataset.color})`;
  });
}

export function renderTrips(list, onOpen) {
  renderStats(list);
  document.getElementById('trip-rows').replaceChildren(...list.map((p, i) => tableRow(p, i, onOpen)));
  document.getElementById('trip-cards').replaceChildren(...list.map((p) => mobileCard(p, onOpen)));
  const empty = list.length === 0;
  document.getElementById('trip-empty').hidden = !empty;
  document.getElementById('trip-scroll').classList.toggle('xl:block', !empty);
  document.getElementById('trip-cards').hidden = empty;
}
