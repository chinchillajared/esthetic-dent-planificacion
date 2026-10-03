// Estado de los vuelos (AirLabs vía backend): texto corto "Estado: …" con un botón para actualizarlo.
// La consulta a AirLabs es manual: al abrir la app solo se muestra el último estado guardado.
import { api } from './api.js';
import { h, icon } from './dom.js';
import { toast } from './ui.js';

const FLIGHT_LEGS = new Set(['llegada', 'nacionalIda', 'nacionalRegreso', 'salida']);
// Fases en las que tiene sentido consultar AirLabs (cerca de la hora del vuelo).
const REFRESHABLE = new Set(['pendiente', 'en-ventana', 'no-encontrado', 'error']);

let estados = new Map(); // "pacienteId:tramo" → respuesta del backend
const keyOf = (pacienteId, tramo) => `${pacienteId}:${tramo}`;

export const isFlightLeg = (key) => FLIGHT_LEGS.has(key);

/** Lee los estados guardados (no consulta AirLabs). Si falla, se conserva lo último conocido. */
export async function loadFlightStatus() {
  try {
    const lista = await api.get('/api/estado-vuelos');
    estados = new Map(lista.map((e) => [keyOf(e.pacienteId, e.tramo), e]));
    return true;
  } catch {
    return false;
  }
}

// AirLabs entrega "YYYY-MM-DD HH:MM" en hora del aeropuerto; se muestra como el resto de la app ("3:40 p. m.").
const timeFmt = new Intl.DateTimeFormat('es-CR', { hour: 'numeric', minute: '2-digit', hour12: true });
function hhmm(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value || '');
  if (!m) return '';
  return timeFmt.format(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])).replace(/\s+/g, ' ');
}

function fromAirLabs(d) {
  const status = (d.status || '').toLowerCase();
  const depDelay = Number(d.depDelayed) || 0;
  const arrDelay = Number(d.arrDelayed) || 0;
  const gate = d.depGate ? `Puerta ${d.depGate}` : '';

  if (status === 'cancelled' || status === 'canceled') return { text: 'Cancelado', tone: 'alert' };
  if (status === 'diverted') return { text: 'Desviado', tone: 'alert' };
  if (status === 'landed') {
    return arrDelay > 15 ? { text: `Aterrizó (${arrDelay} min tarde)`, tone: 'done' } : { text: 'Aterrizó', tone: 'done' };
  }
  if (status === 'en-route' || status === 'active') {
    return arrDelay > 15
      ? { text: `En vuelo · llega ${arrDelay} min tarde`, tone: 'warn' }
      : { text: `En vuelo${d.arrEstimated ? ` · llega ${hhmm(d.arrEstimated)}` : ''}`, tone: 'live' };
  }
  if (status === 'scheduled') {
    if (depDelay > 0) return { text: `Atrasado ${depDelay} min`, tone: 'warn', extra: gate };
    return { text: 'A tiempo', tone: 'ok', extra: gate };
  }
  // El plan de AirLabs puede no incluir el estado: se muestra solo lo que llegó.
  if (d.depEstimated) return { text: `Salida estimada ${hhmm(d.depEstimated)}`, tone: 'muted' };
  return { text: 'Sin datos en tiempo real', tone: 'muted' };
}

const updatedAt = (iso) => (iso
  ? `Actualizado ${new Date(iso).toLocaleString('es-CR', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
  : '');

/** { text, tone, title, refreshable } para un tramo de vuelo, o null si el tramo no es un vuelo. */
export function describeFlight(p, legKey) {
  if (!isFlightLeg(legKey)) return null;
  const vuelo = p[legKey]?.vuelo;
  if (!vuelo) return { text: 'Sin n.º de vuelo', tone: 'muted', title: 'Agregá el número de vuelo en la ficha para ver su estado.' };
  const e = estados.get(keyOf(p.id, legKey));
  const title = (...parts) => [vuelo, ...parts, updatedAt(e?.consultado)].filter(Boolean).join(' · ');
  const refreshable = REFRESHABLE.has(e?.fase);

  switch (e?.fase) {
    case 'programado': return { text: 'Programado', tone: 'muted', title: title('Se puede actualizar desde 8 h antes del vuelo') };
    case 'finalizado': return { text: 'Finalizado', tone: 'muted', title: title() };
    case 'sin-fecha': return { text: 'Falta fecha', tone: 'muted', title: title('Agregá la fecha y hora del vuelo') };
    case 'sin-configurar': return { text: 'Sin conexión a AirLabs', tone: 'muted', title: title('Falta AIRLABS_API_KEY en el servidor') };
    case 'pendiente': return { text: 'Sin consultar', tone: 'muted', title: title('Pulsá actualizar para consultar AirLabs'), refreshable };
    case 'no-encontrado': return { text: 'No encontrado', tone: 'muted', title: title('AirLabs no tiene datos de este vuelo'), refreshable };
    case 'error': return { text: 'Sin actualizar', tone: 'muted', title: title(e.mensaje), refreshable };
    case 'en-ventana': {
      const r = fromAirLabs(e.datos ?? {});
      return { ...r, title: title(r.extra, e.mensaje), refreshable };
    }
    default: return { text: '—', tone: 'muted', title: vuelo };
  }
}

/** Consulta AirLabs para un tramo (acción manual) y actualiza todas las líneas de estado de ese tramo. */
async function refresh(p, legKey, button) {
  button.disabled = true;
  button.classList.add('is-loading');
  try {
    const estado = await api.post('/api/estado-vuelos/actualizar', { pacienteId: p.id, tramo: legKey });
    estados.set(keyOf(p.id, legKey), estado);
    const s = describeFlight(p, legKey);
    if (estado.fase === 'error') toast(estado.mensaje || 'No se pudo consultar AirLabs.', { type: 'error' });
    else toast(`${p[legKey].vuelo}: ${s.text}.`);
  } catch (err) {
    toast(err.message, { type: 'error' });
  }
  document.querySelectorAll(`[data-flight-key="${keyOf(p.id, legKey)}"]`).forEach((el) => {
    const fresh = flightStatusLine(p, legKey, { block: el.classList.contains('block') });
    el.replaceWith(fresh);
    if (el.contains(button)) fresh.querySelector('.flight-refresh')?.focus();
  });
}

/** Línea "Estado: …" (tabla, tarjetas y hoja de la ficha) con su botón de actualizar. */
export function flightStatusLine(p, legKey, { block = false } = {}) {
  const s = describeFlight(p, legKey);
  if (!s) return null;
  const line = h('p', {
    class: `flight-status is-${s.tone}${block ? ' block' : ''}`,
    title: s.title ?? '',
    dataset: { flightKey: keyOf(p.id, legKey) },
  },
  h('span', { class: 'flight-status-label' }, 'Estado:'), ' ',
  h('span', { class: 'flight-status-value' }, s.text));
  if (s.refreshable) {
    const button = h('button', {
      type: 'button',
      class: 'flight-refresh',
      title: 'Actualizar estado con AirLabs',
      'aria-label': `Actualizar estado del vuelo ${p[legKey].vuelo}`,
    }, icon('refresh', 'icon-sm'));
    button.addEventListener('click', () => refresh(p, legKey, button));
    line.append(button);
  }
  return line;
}
