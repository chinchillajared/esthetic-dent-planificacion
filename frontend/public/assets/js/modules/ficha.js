// Ficha del paciente: un portapapeles con la hoja de datos (lectura) y el formulario para crear o editar.
import { DOC_TIPOS } from './data.js';
import { formatDayTime, formatLongDate, formatMoney, formatPrice, h, icon, uid } from './dom.js';
import {
  SPLIT_VIAJE_1, findPatient, paymentTrips, tripsLabel, removePatient, rutaVuelo, savePatient, sedeById, sedes, state,
  tratamientoByName, vuelosPorTipo,
} from './store.js';
import { downloadFile } from './api.js';
import { currentUser } from './auth.js';
import { renderSheet } from './ficha-sheet.js';
import { confirmDialog, toast } from './ui.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = /\.(pdf|jpe?g|png)$/i;

const dialog = document.getElementById('ficha');
const form = document.getElementById('ficha-form');
const tabs = [...dialog.querySelectorAll('[role="tab"]')];

let current = null;     // copia de trabajo del paciente
let isNew = false;
let dirty = false;

const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}

function blankPatient() {
  const sede = sedeById(sedes()[0]?.id);
  return {
    id: uid('p'), nombre: '', pais: '', email: '', telefono: '', sede: sede.id, tratamiento: '', arcos: 1,
    llegada: { ruta: '', fecha: '', vuelo: '' }, nacionalIda: { ruta: 'SJO → Cóbano', fecha: '', vuelo: '', aplica: true },
    pickup: { ruta: 'Aeropuerto → hotel', fecha: '' },
    hotel: { nombre: '', checkin: '', checkout: '' },
    nacionalRegreso: { ruta: 'Cóbano → SJO', fecha: '', vuelo: '', aplica: true }, salida: { ruta: '', fecha: '', vuelo: '' },
    pagos: { total: 0, viajes: 2, viaje1: { monto: 0, estado: 'pendiente' }, viaje2: { monto: 0, estado: 'pendiente' } },
    seguro: { aseguradora: '', poliza: '', estado: 'pendiente' },
    documentos: [], comentarios: [],
  };
}

/* ---------- Pestañas ---------- */
function selectTab(name, { focus = false } = {}) {
  tabs.forEach((tab) => {
    const active = tab.id === `tab-${name}`;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    if (active && focus) tab.focus();
  });
}

tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTab(tab.id.replace('tab-', '')));
  tab.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = tabs[(i + step + tabs.length) % tabs.length];
    selectTab(next.id.replace('tab-', ''), { focus: true });
  });
});

/* ---------- Formulario ---------- */
const fields = () => [...form.querySelectorAll('[name]')];

function fillForm() {
  fields().forEach((el) => {
    const value = getPath(current, el.name);
    if (el.type === 'checkbox') el.checked = value !== false;
    else {
      if (el.dataset.routes) ensureOption(el, value);
      el.value = value ?? '';
    }
  });
  form.elements['pagos.viajes'].value = String(paymentTrips(current));
  form.elements.arcos.value = String(current.arcos === 2 ? 2 : 1);
  syncPlan();
  syncDomestic();
  syncTreatmentHint();
  syncHeader();
  syncSplitHint();
  renderDocs();
  renderNotes();
}

function readForm() {
  fields().forEach((el) => {
    if (el.type === 'checkbox') {
      setPath(current, el.name, el.checked);
      return;
    }
    let value = el.value.trim();
    if (el.dataset.flight !== undefined) value = value.replace(/\s+/g, '').toUpperCase(); // "aa 1234" → "AA1234"
    if (el.type === 'number' || el.name === 'arcos' || el.name === 'pagos.viajes') value = value === '' ? 0 : Number(value);
    setPath(current, el.name, value);
  });
}

function syncHeader() {
  const sede = sedeById(form.elements.sede.value);
  document.getElementById('ficha-eyebrow').textContent = isNew ? 'Nuevo paciente' : 'Ficha del paciente';
  document.getElementById('ficha-title').textContent = form.elements.nombre.value.trim() || (isNew ? 'Paciente sin nombre' : 'Paciente');
  const llegada = formatDayTime(form.elements['llegada.fecha'].value);
  document.getElementById('ficha-subtitle').textContent =
    [`Sede ${sede.nombre}`, llegada ? `Llega el ${llegada}` : 'Llegada por confirmar'].join(' · ');
  document.getElementById('ficha-submit').textContent = isNew ? 'Agregar paciente' : 'Guardar cambios';
  document.getElementById('delete-patient').hidden = isNew;
}

// Sin vuelo nacional (p. ej. Pavas) el traslado desde SJO es terrestre y esas etapas quedan como "No aplica".
function syncDomestic() {
  const domestic = form.elements['nacionalIda.aplica'].checked;
  form.querySelectorAll('[data-domestic]').forEach((el) => {
    el.disabled = !domestic;
    el.closest('.field').classList.toggle('opacity-50', !domestic);
  });
}

// El campo "Arcos" solo aparece si el tratamiento es por arcos (según el catálogo).
function syncArches({ autofill = false } = {}) {
  const trat = tratamientoByName(form.elements.tratamiento.value);
  const field = form.querySelector('[data-arcos]');
  const applies = trat ? Boolean(trat.arcos) : true;
  field.hidden = !applies;
  if (autofill && trat?.arcos) form.elements.arcos.value = String(trat.arcos);
}

const planTrips = () => (Number(form.elements['pagos.viajes'].value) === 1 ? 1 : 2);

// Pago en 1 viaje: se oculta el viaje 2 y el primer pago pasa a llamarse "Pago único".
function syncPlan() {
  const single = planTrips() === 1;
  form.querySelectorAll('[data-viaje2]').forEach((el) => { el.hidden = single; });
  document.getElementById('lbl-viaje1').textContent = single ? 'Pago único' : 'Viaje 1';
}

// Reparte el total según el plan: todo en el viaje 1, o 60/40 entre los dos viajes.
function splitTotal() {
  const total = Number(form.elements['pagos.total'].value) || 0;
  const v1 = planTrips() === 1 ? total : Math.round((total * SPLIT_VIAJE_1) / 100);
  form.elements['pagos.viaje1.monto'].value = v1;
  form.elements['pagos.viaje2.monto'].value = total - v1;
}

function syncSplitHint() {
  const total = Number(form.elements['pagos.total'].value) || 0;
  const single = planTrips() === 1;
  const v1 = Number(form.elements['pagos.viaje1.monto'].value) || 0;
  const v2 = single ? 0 : Number(form.elements['pagos.viaje2.monto'].value) || 0;
  const hint = document.getElementById('split-hint');
  const diff = total - v1 - v2;
  hint.classList.toggle('text-alert', diff !== 0);
  if (diff !== 0) {
    hint.textContent = `Los pagos suman ${formatMoney(v1 + v2)}; faltan ${formatMoney(diff)} para llegar al total.`;
  } else {
    hint.textContent = single
      ? `Pago único de ${formatMoney(v1)} en el primer viaje.`
      : `Reparto actual: viaje 1 ${formatMoney(v1)} · viaje 2 ${formatMoney(v2)}.`;
  }
}

// Precio de lista del tratamiento elegido; si los montos están vacíos y es en dólares, propone el total.
function syncTreatmentHint({ autofill = false } = {}) {
  const hint = document.getElementById('trat-hint');
  const trat = tratamientoByName(form.elements.tratamiento.value);
  hint.textContent = trat ? `Precio de lista: ${formatPrice(trat.precio, trat.moneda)} · ${tripsLabel(trat.viajes).toLowerCase()}` : '';
  syncArches({ autofill });
  // Al elegir un tratamiento del catálogo, el plan de pago toma lo definido en Configuración.
  if (autofill && trat && planTrips() !== Number(trat.viajes)) {
    form.elements['pagos.viajes'].value = String(trat.viajes === 1 ? 1 : 2);
    syncPlan();
    splitTotal();
    syncSplitHint();
  }
  const total = form.elements['pagos.total'];
  if (autofill && trat?.moneda === 'USD' && !Number(total.value)) {
    total.value = trat.precio;
    total.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

form.addEventListener('input', (e) => {
  dirty = true;
  const name = e.target.name;
  if (name === 'tratamiento') syncTreatmentHint({ autofill: true });
  if (name === 'nombre' || name === 'llegada.fecha') syncHeader();
  if (name === 'pagos.total') splitTotal();
  if (name === 'pagos.viajes') {
    syncPlan();
    splitTotal();
  }
  if (name?.startsWith('pagos.')) syncSplitHint();
});

form.elements.sede.addEventListener('change', syncHeader);
form.elements['nacionalIda.aplica'].addEventListener('change', syncDomestic);

/* ---------- Documentos ---------- */
function guessType(name) {
  const n = name.toLowerCase();
  if (/(pasaporte|passport|passeport|reisepass)/.test(n)) return 'pasaporte';
  if (/(seguro|poliza|insurance)/.test(n)) return 'seguro';
  if (/(rx|radiograf|panoram|tomograf)/.test(n)) return 'radiografia';
  if (/(comprobante|transfer|recibo|receipt)/.test(n)) return 'comprobante';
  return 'otro';
}

function renderDocs() {
  const list = document.getElementById('ficha-docs');
  if (!current.documentos.length) {
    list.replaceChildren(h('li', { class: 'rounded-xl bg-paper p-4 text-sm text-muted' },
      'Este paciente todavía no tiene documentos. Necesita pasaporte y seguro de viaje antes de llegar.'));
    return;
  }
  list.replaceChildren(...current.documentos.map((d) => {
    const select = h('select', { class: 'control min-h-9 w-auto py-1 text-sm', 'aria-label': `Tipo de ${d.nombre}` },
      Object.entries(DOC_TIPOS).map(([value, label]) => h('option', { value, selected: value === d.tipo }, label)));
    select.addEventListener('change', () => { d.tipo = select.value; dirty = true; });
    return h('li', { class: 'flex flex-wrap items-center gap-3 rounded-xl border border-line p-3' },
      h('span', { class: 'grid size-9 flex-none place-items-center rounded-lg bg-haze text-azure' }, icon('file', 'icon-sm')),
      h('div', { class: 'min-w-0 flex-1' },
        h('p', { class: 'truncate font-display font-bold' }, d.nombre),
        h('p', { class: `text-xs ${d._file ? 'text-azure' : 'text-muted'}` },
          d._file ? 'Se subirá al guardar los cambios' : `Cargado el ${formatLongDate(d.fecha)}`),
      ),
      select,
      d._file ? null : h('button', {
        type: 'button', class: 'btn-icon size-9', 'aria-label': `Descargar ${d.nombre}`, title: 'Descargar',
        onclick: () => downloadFile(`/api/documentos/${d.id}/archivo`, d.nombre)
          .catch((err) => toast(err.message, { type: 'error' })),
      }, icon('upload', 'icon-sm rotate-180')),
      h('button', {
        type: 'button', class: 'btn-icon size-9 text-alert', 'aria-label': `Quitar ${d.nombre}`,
        onclick: async () => {
          const ok = await confirmDialog({ title: '¿Quitar documento?', text: `Se quitará «${d.nombre}» de la ficha.`, confirmLabel: 'Quitar' });
          if (!ok) return;
          current.documentos = current.documentos.filter((x) => x.id !== d.id);
          dirty = true;
          renderDocs();
        },
      }, icon('trash', 'icon-sm')),
    );
  }));
}

function addFiles(files) {
  const today = new Date().toISOString().slice(0, 10);
  let added = 0;
  for (const file of files) {
    if (!ALLOWED_EXT.test(file.name)) {
      toast(`«${file.name}» no es PDF, JPG ni PNG.`, { type: 'error' });
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast(`«${file.name}» supera los 10 MB.`, { type: 'error' });
      continue;
    }
    current.documentos.push({ id: uid('doc'), nombre: file.name, tipo: guessType(file.name), fecha: today, _file: file });
    added += 1;
  }
  if (added) {
    dirty = true;
    renderDocs();
    toast(added === 1 ? 'Documento listo: se subirá al guardar los cambios.' : `${added} documentos listos: se subirán al guardar los cambios.`);
  }
}

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('doc-input');
fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
['dragenter', 'dragover'].forEach((t) => dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((t) => dropzone.addEventListener(t, () => dropzone.classList.remove('is-over')));
dropzone.addEventListener('drop', (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); });

/* ---------- Comentarios ---------- */
function renderNotes() {
  const list = document.getElementById('ficha-notes');
  if (!current.comentarios.length) {
    list.replaceChildren(h('li', { class: 'rounded-xl bg-paper p-4 text-sm text-muted' }, 'Sin comentarios todavía.'));
    return;
  }
  list.replaceChildren(...[...current.comentarios].reverse().map((c) => h('li', { class: 'rounded-xl border border-line p-4' },
    h('p', { class: 'flex flex-wrap items-center gap-2 text-xs text-muted' },
      icon('message', 'icon-sm text-azure'),
      h('span', { class: 'font-display font-bold text-deep' }, c.autor), '·',
      c._pending ? h('span', { class: 'text-azure' }, 'se guardará con los cambios') : formatDayTime(c.fecha)),
    h('p', { class: 'mt-2 text-sm' }, c.texto),
  )));
}

dialog.querySelector('[data-action="add-note"]').addEventListener('click', () => {
  const input = document.getElementById('note-input');
  const texto = input.value.trim();
  if (!texto) {
    toast('Escribí el comentario antes de agregarlo.', { type: 'error' });
    input.focus();
    return;
  }
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  current.comentarios.push({ autor: currentUser()?.name ?? 'Yo', fecha: local, texto, _pending: true });
  input.value = '';
  dirty = true;
  renderNotes();
});

/* ---------- Modos: lectura (hoja) y edición (formulario) ---------- */
const sheet = document.getElementById('ficha-view');

function setMode(mode) {
  sheet.hidden = mode !== 'view';
  form.hidden = mode !== 'edit';
  dialog.setAttribute('aria-labelledby', mode === 'view' ? 'ficha-view-title' : 'ficha-title');
  if (mode === 'view') {
    renderSheet(sheet, current, { onEdit: startEdit, onClose: requestClose });
    sheet.querySelector('.paper-scroll').scrollTop = 0;
  } else {
    form.querySelector('.min-h-0.flex-1').scrollTop = 0;
  }
}

function startEdit(tab = 'viaje') {
  setMode('edit');
  selectTab(typeof tab === 'string' ? tab : 'viaje');
  tabs.find((t) => t.tabIndex === 0).focus();
}

const confirmDiscard = () => confirmDialog({
  title: '¿Descartar cambios?',
  text: 'Hay cambios sin guardar en esta ficha. Si continuás se van a perder.',
  confirmLabel: 'Descartar',
  cancelLabel: 'Seguir editando',
});

/* ---------- Abrir, guardar, cerrar ---------- */
// Un paciente existente se abre en lectura; uno nuevo (o si se pide una pestaña) directo en edición.
export function openFicha(id = null, tab = null) {
  const found = id ? findPatient(id) : null;
  isNew = !found;
  current = found ? structuredClone(found) : blankPatient();
  dirty = false;
  fillForm();
  dialog.showModal();
  if (isNew) {
    setMode('edit');
    selectTab('viaje');
    form.elements.nombre.focus();
  } else if (tab) {
    startEdit(tab);
  } else {
    setMode('view');
    sheet.querySelector('[data-action="edit-ficha"]').focus();
  }
}

async function requestClose() {
  if (dirty && !(await confirmDiscard())) return;
  dialog.close();
}

// Cancelar la edición vuelve a la hoja con los datos guardados (o cierra si era un paciente nuevo).
async function cancelEdit() {
  if (dirty && !(await confirmDiscard())) return;
  if (isNew) {
    dirty = false;
    dialog.close();
    return;
  }
  current = structuredClone(findPatient(current.id));
  dirty = false;
  fillForm();
  setMode('view');
  sheet.querySelector('[data-action="edit-ficha"]').focus();
}

dialog.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });
dialog.querySelectorAll('[data-action="close-ficha"]').forEach((b) => b.addEventListener('click', requestClose));
dialog.querySelector('[data-action="cancel-edit"]').addEventListener('click', cancelEdit);
dialog.addEventListener('click', (e) => { if (e.target === dialog) requestClose(); });

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!current) return;
  const nombre = form.elements.nombre;
  if (!nombre.value.trim()) {
    selectTab('viaje');
    nombre.focus();
    toast('Escribí el nombre del paciente para poder guardarlo.', { type: 'error' });
    return;
  }
  const email = form.elements.email;
  if (email.value && !email.checkValidity()) {
    selectTab('viaje');
    email.focus();
    toast('Revisá el correo: el formato no es válido.', { type: 'error' });
    return;
  }
  readForm();
  current.nacionalRegreso.aplica = current.nacionalIda.aplica;
  if (current.pagos.viajes === 1) current.pagos.viaje2 = { monto: 0, estado: 'pendiente' };
  if (form.querySelector('[data-arcos]').hidden) current.arcos = null;
  saveChanges();
});

/** Diferencias de documentos y comentarios respecto de lo guardado en el servidor. */
function pendingChanges() {
  const saved = isNew ? { documentos: [] } : findPatient(current.id) ?? { documentos: [] };
  const keep = new Set(current.documentos.map((d) => d.id));
  return {
    removedDocs: saved.documentos.filter((d) => !keep.has(d.id)).map((d) => d.id),
    retyped: current.documentos
      .filter((d) => !d._file)
      .filter((d) => saved.documentos.find((o) => o.id === d.id)?.tipo !== d.tipo)
      .map((d) => ({ id: d.id, tipo: d.tipo })),
    files: current.documentos.filter((d) => d._file).map((d) => ({ file: d._file, tipo: d.tipo })),
    notes: current.comentarios.filter((c) => c._pending).map((c) => c.texto),
  };
}

async function saveChanges() {
  const submit = document.getElementById('ficha-submit');
  const label = submit.textContent;
  submit.disabled = true;
  submit.textContent = 'Guardando…';
  const wasNew = isNew;
  const { patient, error } = await savePatient(current, { isNew, changes: pendingChanges() });
  submit.disabled = false;
  submit.textContent = label;
  if (error) {
    toast(error, { type: 'error' });
    return;
  }
  // Después de guardar, la ficha vuelve a la hoja de lectura con los datos del servidor.
  isNew = false;
  current = structuredClone(patient);
  dirty = false;
  fillForm();
  setMode('view');
  sheet.querySelector('[data-action="edit-ficha"]').focus();
  toast(wasNew ? `${current.nombre} se agregó a la planificación.` : 'Cambios guardados.');
}

dialog.querySelector('[data-action="delete-patient"]').addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: '¿Eliminar paciente?',
    text: `Se eliminará la ficha de ${current.nombre} con su viaje, pagos, documentos y comentarios.`,
    confirmLabel: 'Eliminar',
  });
  if (!ok) return;
  const error = await removePatient(current.id);
  if (error) {
    toast(error, { type: 'error' });
    return;
  }
  dirty = false;
  dialog.close();
  toast('Paciente eliminado.');
});

// Opciones que dependen de los catálogos de Configuración.
export function refreshCatalogOptions() {
  const select = document.getElementById('ficha-sede');
  const previous = select.value;
  select.replaceChildren(...sedes().map((s) => h('option', { value: s.id }, s.nombre)));
  if (sedes().some((s) => s.id === previous)) select.value = previous;
  document.getElementById('tratamientos').replaceChildren(
    ...state.catalogos.tratamientos.map((t) => h('option', { value: t.nombre })),
  );
  document.getElementById('hoteles').replaceChildren(
    ...state.catalogos.hoteles.map((hotel) => h('option', { value: hotel.nombre })),
  );
  form.querySelectorAll('select[data-routes]').forEach((select) => {
    select.replaceChildren(
      h('option', { value: '' }, 'Seleccionar vuelo'),
      ...vuelosPorTipo(select.dataset.routes).map((v) => h('option', { value: rutaVuelo(v) }, rutaVuelo(v))),
    );
  });
}

// Conserva rutas guardadas que ya no están en el catálogo.
function ensureOption(select, value) {
  if (value && ![...select.options].some((o) => o.value === value)) {
    select.append(h('option', { value }, `${value} (fuera del catálogo)`));
  }
}
