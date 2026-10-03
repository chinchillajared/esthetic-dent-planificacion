// Estado de la aplicación sincronizado con la API (FastAPI) y reglas de negocio derivadas.
// Las funciones que modifican datos son asíncronas: devuelven un mensaje de error (string) o null.
import { api } from './api.js';
import { loadFlightStatus } from './flight-status.js';
import { DOCS_REQUERIDOS } from './data.js';
import { normalize, parseDate } from './dom.js';

const listeners = new Set();

export const state = {
  pacientes: [],
  catalogos: { sedes: [], tratamientos: [], hoteles: [], vuelos: [] },
};

// Porcentaje del total que se cobra en el viaje 1 (el resto en el viaje 2).
export const SPLIT_VIAJE_1 = 60;

const SEDE_COLORS = ['#034C8C', '#0568A6', '#5CB9F2', '#88C9F2'];

export const subscribe = (fn) => listeners.add(fn);
export const notify = () => listeners.forEach((fn) => fn());

/** Carga catálogos y pacientes desde el servidor. */
export async function loadAll() {
  const [catalogos, pacientes] = await Promise.all([api.get('/api/catalogos'), api.get('/api/pacientes')]);
  state.catalogos = catalogos;
  state.pacientes = pacientes;
  notify();
}

/** Ejecuta una llamada a la API y devuelve null si salió bien o el mensaje de error. */
async function attempt(fn) {
  try {
    await fn();
    notify();
    return null;
  } catch (err) {
    return err.message;
  }
}

/* ---------- Sedes ---------- */
const SIN_SEDE = { id: '', nombre: 'Sin sede' };

export const sedes = () => state.catalogos.sedes;
export const sedeById = (id) => sedes().find((s) => s.id === id) ?? sedes()[0] ?? SIN_SEDE;
export const sedeColor = (id) => SEDE_COLORS[Math.max(0, sedes().findIndex((s) => s.id === id)) % SEDE_COLORS.length];
export const patientsInSede = (id) => state.pacientes.filter((p) => p.sede === id).length;

const sameName = (a, b) => normalize(a).trim() === normalize(b).trim();
const byName = (a, b) => a.nombre.localeCompare(b.nombre, 'es');

export const addSede = (nombre) => attempt(async () => {
  const sede = await api.post('/api/sedes', { nombre });
  state.catalogos.sedes = [...sedes(), sede].sort(byName);
});

export const removeSede = (id) => attempt(async () => {
  await api.del(`/api/sedes/${encodeURIComponent(id)}`);
  state.catalogos.sedes = sedes().filter((s) => s.id !== id);
});

/* ---------- Tratamientos ---------- */
export const tratamientoByName = (nombre) => state.catalogos.tratamientos.find((t) => sameName(t.nombre, nombre ?? ''));

export const addTratamiento = (nombre, precio, moneda, viajes = 2, arcos = null) => attempt(async () => {
  const t = await api.post('/api/tratamientos', { nombre, precio, moneda, viajes, arcos });
  state.catalogos.tratamientos.push(t);
});

export const removeTratamiento = (id) => attempt(async () => {
  await api.del(`/api/tratamientos/${id}`);
  state.catalogos.tratamientos = state.catalogos.tratamientos.filter((t) => t.id !== id);
});

/* ---------- Hoteles ---------- */
export const addHotel = (nombre) => attempt(async () => {
  state.catalogos.hoteles.push(await api.post('/api/hoteles', { nombre }));
});

export const removeHotel = (id) => attempt(async () => {
  await api.del(`/api/hoteles/${id}`);
  state.catalogos.hoteles = state.catalogos.hoteles.filter((h) => h.id !== id);
});

/* ---------- Vuelos ---------- */
export const rutaVuelo = (v) => `${v.origen} → ${v.destino}`;
export const vuelosPorTipo = (tipo) => state.catalogos.vuelos.filter((v) => v.tipo === tipo);

export const addVuelo = (tipo, origen, destino, precio = null, moneda = 'USD') => attempt(async () => {
  state.catalogos.vuelos.push(await api.post('/api/vuelos', { tipo, origen, destino, precio, moneda }));
});

export const removeVuelo = (id) => attempt(async () => {
  await api.del(`/api/vuelos/${id}`);
  state.catalogos.vuelos = state.catalogos.vuelos.filter((v) => v.id !== id);
});

/* ---------- Pacientes ---------- */
export const findPatient = (id) => state.pacientes.find((p) => p.id === id);

function putLocal(patient) {
  const i = state.pacientes.findIndex((p) => p.id === patient.id);
  if (i === -1) state.pacientes.push(patient);
  else state.pacientes[i] = patient;
}

// Campos que acepta la API (los documentos y comentarios tienen sus propias rutas).
const PATIENT_FIELDS = [
  'nombre', 'pais', 'email', 'telefono', 'sede', 'tratamiento', 'arcos', 'llegada', 'nacionalIda', 'pickup',
  'hotel', 'nacionalRegreso', 'salida', 'pagos', 'seguro',
];
const patientPayload = (p) => Object.fromEntries(PATIENT_FIELDS.map((k) => [k, p[k] ?? null]));

/**
 * Guarda los datos del paciente y, después, los cambios de documentos y comentarios hechos en la ficha.
 * changes: { files: [{ file, tipo }], removedDocs: [id], retyped: [{ id, tipo }], notes: [texto] }
 * Devuelve { patient, error }.
 */
export async function savePatient(patient, { isNew, changes }) {
  try {
    const payload = patientPayload(patient);
    let saved = isNew
      ? await api.post('/api/pacientes', payload)
      : await api.put(`/api/pacientes/${patient.id}`, payload);
    const id = saved.id;
    for (const docId of changes.removedDocs) await api.del(`/api/documentos/${docId}`);
    for (const { id: docId, tipo } of changes.retyped) await api.patch(`/api/documentos/${docId}`, { tipo });
    for (const { file, tipo } of changes.files) {
      const form = new FormData();
      form.append('archivo', file);
      form.append('tipo', tipo);
      await api.upload(`/api/pacientes/${id}/documentos`, form);
    }
    for (const texto of changes.notes) await api.post(`/api/pacientes/${id}/comentarios`, { texto });
    const hasExtras = changes.removedDocs.length + changes.retyped.length + changes.files.length + changes.notes.length > 0;
    if (hasExtras) saved = await api.get(`/api/pacientes/${id}`);
    putLocal(saved);
    await loadFlightStatus();
    notify();
    return { patient: saved, error: null };
  } catch (err) {
    // Si el paciente se creó pero falló un documento, se refleja lo que sí quedó guardado.
    return { patient: null, error: err.message };
  }
}

export const removePatient = (id) => attempt(async () => {
  await api.del(`/api/pacientes/${id}`);
  state.pacientes = state.pacientes.filter((p) => p.id !== id);
});

// Etapas del viaje en orden: es la "ruta" que se dibuja en la tabla.
export const LEGS = [
  { key: 'llegada', label: 'Vuelo internacional de llegada', short: 'Llegada', kind: 'int' },
  { key: 'nacionalIda', label: 'Vuelo nacional de ida', short: 'Vuelo nacional', kind: 'nac' },
  { key: 'pickup', label: 'Pick-up', short: 'Pick-up', kind: 'pickup' },
  { key: 'hotel', label: 'Hotel', short: 'Hospedaje', kind: 'hotel' },
  { key: 'nacionalRegreso', label: 'Vuelo nacional de regreso', short: 'Vuelo de regreso', kind: 'nac' },
  { key: 'salida', label: 'Vuelo internacional de salida', short: 'Salida', kind: 'int' },
];

const HOUR = 3_600_000;

// Momento en que empieza cada etapa. El hospedaje arranca una hora después del pick-up
// (o a las 15:00 del check-in si no hay pick-up).
function stageStarts(p) {
  const at = (v) => parseDate(v)?.getTime() ?? null;
  const domestic = hasDomesticFlight(p);
  const pickup = at(p.pickup?.fecha);
  return {
    llegada: at(p.llegada?.fecha),
    nacionalIda: domestic ? at(p.nacionalIda?.fecha) : null,
    pickup,
    hotel: pickup !== null ? pickup + HOUR : at(p.hotel?.checkin && `${p.hotel.checkin}T15:00`),
    nacionalRegreso: domestic ? at(p.nacionalRegreso?.fecha) : null,
    salida: at(p.salida?.fecha),
  };
}

/** Fija la etapa a mano (arrastrando el punto); null vuelve al cálculo automático por fechas. */
export const setManualStage = (id, legKey) => attempt(async () => {
  putLocal(await api.patch(`/api/pacientes/${id}/etapa`, { etapa: legKey }));
});

export const isManualStage = (p) => Boolean(p.etapaManual);

/** Etapa del viaje en la que está el paciente ahora, o null si no ha llegado o ya se fue. */
export function currentStage(p, now = Date.now()) {
  if (p.etapaManual) {
    const manual = LEGS.find((l) => l.key === p.etapaManual);
    if (manual && legStatus(p, manual.key) !== 'no-aplica') return manual;
  }
  const starts = stageStarts(p);
  const end = tripEnd(p, starts);
  if (end && now > end) return null;
  return LEGS.reduce((cur, leg) => (starts[leg.key] !== null && starts[leg.key] <= now ? leg : cur), null);
}

// El viaje termina 6 h después del vuelo de salida (o al día siguiente del check-out si no hay vuelo).
function tripEnd(p, starts) {
  const checkout = parseDate(p.hotel?.checkout);
  if (starts.salida !== null) return starts.salida + 6 * HOUR;
  return checkout ? checkout.getTime() + 24 * HOUR : null;
}

/** en-curso | por-iniciar | finalizado */
export function tripPhase(p, now = Date.now()) {
  if (currentStage(p, now)) return 'en-curso';
  const end = tripEnd(p, stageStarts(p));
  return end && now > end ? 'finalizado' : 'por-iniciar';
}

export const applicableLegs = (p) => LEGS.filter((l) => legStatus(p, l.key) !== 'no-aplica');

// El vuelo nacional se define por paciente (p. ej. quien va a Pavas llega por tierra desde SJO).
export const hasDomesticFlight = (patient) => patient.nacionalIda?.aplica !== false;

/** confirmado | pendiente | no-aplica */
export function legStatus(patient, key) {
  if ((key === 'nacionalIda' || key === 'nacionalRegreso') && !hasDomesticFlight(patient)) {
    return 'no-aplica';
  }
  if (key === 'hotel') return patient.hotel?.nombre && patient.hotel?.checkin ? 'confirmado' : 'pendiente';
  return patient[key]?.fecha ? 'confirmado' : 'pendiente';
}

export const arrivalDate = (p) => parseDate(p.llegada?.fecha) ?? parseDate(p.hotel?.checkin);

const toMonthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export function monthKey(p) {
  const d = arrivalDate(p);
  return d ? toMonthKey(d) : 'sin-fecha';
}

/** Meses que abarca el viaje (de la llegada a la salida), p. ej. un viaje del 30 sep al 8 oct cuenta en ambos. */
export function tripMonths(p) {
  const start = arrivalDate(p);
  if (!start) return [];
  const end = parseDate(p.salida?.fecha) ?? parseDate(p.hotel?.checkout) ?? start;
  const months = [];
  for (const d = new Date(start.getFullYear(), start.getMonth(), 1); d <= end; d.setMonth(d.getMonth() + 1)) {
    months.push(toMonthKey(d));
  }
  return months.length ? months : [toMonthKey(start)];
}

export const archLabel = (n) => `${n} ${Number(n) === 1 ? 'arco' : 'arcos'}`;

/** El tratamiento del paciente se cobra por arcos (según el catálogo; si no está, según la ficha). */
export function usesArches(p) {
  const trat = tratamientoByName(p.tratamiento);
  return trat ? Boolean(trat.arcos) : Boolean(p.arcos);
}

/** En cuántos viajes paga el paciente (1 = pago único). Por defecto, dos. */
export const paymentTrips = (p) => (Number(p.pagos?.viajes) === 1 ? 1 : 2);
export const tripsLabel = (n) => (Number(n) === 1 ? 'Pago en 1 viaje' : 'Pago en 2 viajes');

export const pendingBalance = (p) =>
  ['viaje1', 'viaje2'].reduce((sum, k) => sum + (p.pagos[k].estado === 'pagado' ? 0 : Number(p.pagos[k].monto) || 0), 0);

export const hasPendingPayments = (p) => pendingBalance(p) > 0;

export const hasUnconfirmedLegs = (p) => LEGS.some((l) => legStatus(p, l.key) === 'pendiente');

export const missingDocs = (p) =>
  DOCS_REQUERIDOS.filter((tipo) => !p.documentos.some((d) => d.tipo === tipo));

export function matchesQuery(p, q) {
  if (!q) return true;
  const hay = normalize([p.nombre, p.pais, p.email, p.tratamiento, p.hotel?.nombre, sedeById(p.sede).nombre].join(' '));
  return normalize(q).split(/\s+/).every((t) => hay.includes(t));
}

export const byArrival = (a, b) => (arrivalDate(a)?.getTime() ?? Infinity) - (arrivalDate(b)?.getTime() ?? Infinity);
