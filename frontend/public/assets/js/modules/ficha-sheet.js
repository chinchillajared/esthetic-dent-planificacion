// Hoja de lectura de la ficha: el paciente presentado como un formulario sobre un portapapeles,
// con lista de verificación, filas de datos, sello de estado y línea de firma.
import { DOC_TIPOS } from './data.js';
import { flightStatusLine } from './flight-status.js';
import { formatDay, formatDayTime, formatLongDate, formatMoney, formatPrice, h, icon } from './dom.js';
import {
  LEGS, archLabel, currentStage, legStatus, paymentTrips, pendingBalance, sedeById, tratamientoByName, tripPhase,
  tripsLabel, usesArches,
} from './store.js';

const row = (label, ...value) => h('div', { class: 'paper-row' },
  h('dt', {}, label),
  h('dd', {}, ...value),
);

const section = (title, ...children) => h('section', { class: 'paper-section' },
  h('h3', { class: 'paper-section-title' }, title),
  ...children,
);

const muted = (text) => h('span', { class: 'text-muted' }, text);

function checklist(p) {
  const single = paymentTrips(p) === 1;
  const items = [
    { label: 'Pasaporte cargado', done: p.documentos.some((d) => d.tipo === 'pasaporte') },
    { label: 'Seguro de viaje vigente', done: p.seguro?.estado === 'vigente' },
    { label: 'Vuelo de llegada confirmado', done: legStatus(p, 'llegada') === 'confirmado' },
    { label: 'Hotel confirmado', done: legStatus(p, 'hotel') === 'confirmado' },
    { label: 'Vuelo de salida confirmado', done: legStatus(p, 'salida') === 'confirmado' },
    { label: single ? 'Pago único recibido' : 'Pago del viaje 1 recibido', done: p.pagos.viaje1.estado === 'pagado' },
    ...(single ? [] : [{ label: 'Pago del viaje 2 recibido', done: p.pagos.viaje2.estado === 'pagado' }]),
  ];
  const done = items.filter((i) => i.done).length;
  return section(`Lista de verificación · ${done} de ${items.length}`,
    h('ul', { class: 'checklist' }, items.map((item) => h('li', { class: item.done ? 'is-done' : '' },
      h('span', { class: 'check-box', 'aria-hidden': 'true' }, item.done ? icon('check', 'icon-sm') : null),
      h('span', {}, item.label),
      h('span', { class: 'sr-only' }, item.done ? ' (listo)' : ' (pendiente)'),
    ))),
  );
}

function stamp(p) {
  const cur = currentStage(p);
  const phase = cur ? 'en-curso' : tripPhase(p);
  const title = { 'en-curso': 'En curso', 'por-iniciar': 'Por iniciar', finalizado: 'Finalizado' }[phase];
  return h('div', { class: `paper-stamp is-${phase}`, role: 'img', 'aria-label': `Estado del viaje: ${title}${cur ? `, ${cur.short}` : ''}` },
    h('span', { class: 'paper-stamp-ring' },
      h('span', { class: 'paper-stamp-title' }, title),
      h('span', { class: 'paper-stamp-sub' }, cur ? cur.short : 'Esthetic Dent'),
    ),
  );
}

function legValue(p, leg) {
  const status = legStatus(p, leg.key);
  if (status === 'no-aplica') return muted('No aplica · traslado terrestre');
  if (leg.key === 'hotel') {
    const hotel = p.hotel;
    if (!hotel?.nombre) return muted('Por definir');
    const fechas = hotel.checkin ? ` · ${formatDay(hotel.checkin)} al ${formatDay(hotel.checkout) || '¿?'}` : '';
    return [h('strong', {}, hotel.nombre), fechas];
  }
  if (leg.key === 'pickup') return p.pickup.fecha ? `Aeropuerto → hotel · ${formatDayTime(p.pickup.fecha)}` : muted('Por confirmar');
  const tramo = p[leg.key];
  return [
    h('strong', {}, tramo.ruta || 'Ruta por definir'),
    tramo.vuelo ? ` · ${tramo.vuelo}` : '',
    tramo.fecha ? ` · ${formatDayTime(tramo.fecha)}` : muted(' · por confirmar'),
    flightStatusLine(p, leg.key, { block: true }),
  ];
}

function payValue(pago) {
  const paid = pago.estado === 'pagado';
  return [h('strong', {}, formatMoney(pago.monto)), ' ', h('span', { class: `pill ${paid ? '' : 'pill-pending'}` }, paid ? 'Pagado' : 'Pendiente')];
}

export function renderSheet(container, p, { onEdit, onClose }) {
  const sede = sedeById(p.sede);
  const trat = tratamientoByName(p.tratamiento);
  const single = paymentTrips(p) === 1;
  const balance = pendingBalance(p);
  const ultimos = [...p.comentarios].reverse().slice(0, 2);

  container.replaceChildren(
    h('div', { class: 'paper-scroll' },
      h('header', { class: 'paper-head' },
        h('div', { class: 'min-w-0 flex-1' },
          h('p', { class: 'eyebrow' }, 'Ficha del paciente'),
          h('h2', { class: 'paper-title', id: 'ficha-view-title' }, p.nombre),
          h('p', { class: 'mt-1 text-start text-sm text-muted' }, [p.pais, `Sede ${sede.nombre}`, p.tratamiento].filter(Boolean).join(' · ')),
        ),
        stamp(p),
        h('button', { type: 'button', class: 'btn-icon size-9 flex-none', 'aria-label': 'Cerrar ficha', onclick: onClose }, icon('x', 'icon-sm')),
      ),
      h('div', { class: 'paper-rule', 'aria-hidden': 'true' }),

      checklist(p),

      section('Contacto',
        h('dl', {},
          row('Correo', p.email || muted('Sin correo')),
          row('Teléfono', p.telefono || muted('Sin teléfono')),
        ),
      ),

      section('Itinerario',
        h('dl', {}, LEGS.map((leg) => row(leg.label, legValue(p, leg)))),
      ),

      section('Tratamiento y pagos',
        h('dl', {},
          row('Tratamiento', p.tratamiento ? h('strong', {}, p.tratamiento) : muted('Por definir'),
            usesArches(p) && p.arcos ? ` · ${archLabel(p.arcos)}` : '',
            trat ? muted(` · lista ${formatPrice(trat.precio, trat.moneda)}`) : ''),
          row('Plan de pago', tripsLabel(paymentTrips(p))),
          single
            ? row('Pago único', payValue(p.pagos.viaje1))
            : [row('Viaje 1', payValue(p.pagos.viaje1)), row('Viaje 2', payValue(p.pagos.viaje2))],
          row('Total', h('strong', {}, formatMoney(p.pagos.total)),
            balance ? h('span', { class: 'text-alert' }, ` · pendiente ${formatMoney(balance)}`) : muted(' · pagado por completo')),
        ),
      ),

      section('Seguro y documentos',
        h('dl', {},
          row('Seguro', p.seguro?.estado === 'vigente'
            ? [h('strong', {}, p.seguro.aseguradora || 'Vigente'), p.seguro.poliza ? muted(` · póliza ${p.seguro.poliza}`) : '']
            : h('span', { class: 'pill pill-pending' }, 'Pendiente')),
          row('Documentos', p.documentos.length
            ? h('ul', { class: 'grid gap-1' }, p.documentos.map((d) => h('li', {},
              h('strong', {}, d.nombre), muted(` · ${DOC_TIPOS[d.tipo] ?? 'Otro'} · ${formatLongDate(d.fecha)}`))))
            : muted('Sin documentos cargados')),
        ),
      ),

      section('Comentarios',
        ultimos.length
          ? h('ul', { class: 'grid gap-2' }, ultimos.map((c) => h('li', { class: 'paper-note' },
            h('p', { class: 'text-xs text-muted' }, `${c.autor} · ${formatDayTime(c.fecha)}`),
            h('p', { class: 'mt-0.5' }, c.texto),
          )))
          : h('p', { class: 'text-sm text-muted' }, 'Sin comentarios.'),
      ),
    ),
    h('footer', { class: 'paper-foot' },
      h('div', { class: 'paper-sign' },
        h('span', { class: 'paper-sign-line', 'aria-hidden': 'true' }),
        h('span', { class: 'text-xs text-muted' }, 'Coordinación · Esthetic Dent International'),
      ),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: onClose }, 'Cerrar'),
      h('button', { type: 'button', class: 'btn btn-primary', 'data-action': 'edit-ficha', onclick: onEdit }, icon('pencil', 'icon-sm'), 'Editar ficha'),
    ),
  );
}
