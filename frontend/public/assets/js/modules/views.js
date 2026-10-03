// Vistas secundarias: Pacientes, Documentos y Configuración.
import { DOC_TIPOS, TIPOS_VUELO } from './data.js';
import { formatDay, formatLongDate, formatMoney, formatPrice, h, icon, initials } from './dom.js';
import {
  addHotel, addSede, addTratamiento, addVuelo, byArrival, matchesQuery, missingDocs, patientsInSede, pendingBalance,
  removeHotel, removeSede, removeTratamiento, removeVuelo, rutaVuelo, sedes, state, tripsLabel, vuelosPorTipo,
  archLabel,
} from './store.js';
import { sedePill } from './trips.js';
import { downloadFile } from './api.js';
import { confirmDialog, toast } from './ui.js';

/* ---------- Pacientes ---------- */
export function renderPatients(query, onOpen) {
  const list = state.pacientes.filter((p) => matchesQuery(p, query)).sort(byArrival);
  const grid = document.getElementById('patient-grid');

  if (!list.length) {
    grid.replaceChildren(h('li', { class: 'card p-8 text-muted sm:col-span-2' },
      'Ningún paciente coincide con la búsqueda. Probá con otro nombre, país o correo.'));
    return;
  }

  grid.replaceChildren(...list.map((p) => {
    const balance = pendingBalance(p);
    const missing = missingDocs(p);
    return h('li', { class: 'card flex flex-col gap-4 p-5 animate-fade-up' },
      h('div', { class: 'flex items-start gap-3' },
        h('span', { class: 'grid size-11 flex-none place-items-center rounded-full bg-haze font-display font-bold text-ink', 'aria-hidden': 'true' }, initials(p.nombre)),
        h('div', { class: 'min-w-0 flex-1' },
          h('h2', { class: 'truncate text-base font-bold' }, p.nombre),
          h('p', { class: 'truncate text-[0.8125rem] text-muted' }, `${p.pais} · ${p.email || 'Sin correo'}`),
        ),
        sedePill(p.sede),
      ),
      h('dl', { class: 'grid grid-cols-2 gap-3 text-sm' },
        h('div', {}, h('dt', { class: 'eyebrow' }, 'Tratamiento'), h('dd', { class: 'm-0 font-display font-bold' }, p.tratamiento || 'Por definir')),
        h('div', {}, h('dt', { class: 'eyebrow' }, 'Viaje'), h('dd', { class: 'm-0 font-display font-bold' },
          p.llegada.fecha ? `${formatDay(p.llegada.fecha)} – ${formatDay(p.salida.fecha) || '¿?'}` : 'Por definir')),
        h('div', {}, h('dt', { class: 'eyebrow' }, 'Saldo pendiente'), h('dd', { class: `m-0 font-display font-bold ${balance ? 'text-alert' : ''}` }, formatMoney(balance))),
        h('div', {}, h('dt', { class: 'eyebrow' }, 'Documentos'), h('dd', { class: `m-0 font-display font-bold ${missing.length ? 'text-alert' : ''}` },
          missing.length ? `Faltan ${missing.length}` : 'Completos')),
      ),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm mt-auto self-start', onclick: () => onOpen(p.id) }, 'Abrir ficha', icon('arrow-right', 'icon-sm')),
    );
  }));
}

/* ---------- Documentos ---------- */
export function renderDocuments(onOpen) {
  const rows = state.pacientes
    .flatMap((p) => p.documentos.map((d) => ({ ...d, paciente: p })))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  const tbody = document.getElementById('doc-rows');
  tbody.replaceChildren(...(rows.length ? rows.map((d) => h('tr', {},
    h('td', {}, h('span', { class: 'flex items-center gap-2 font-display font-bold' }, icon('file', 'icon-sm text-azure'), d.nombre)),
    h('td', {}, d.paciente.nombre),
    h('td', {}, h('span', { class: 'pill pill-plain' }, DOC_TIPOS[d.tipo] ?? 'Otro')),
    h('td', { class: 'whitespace-nowrap text-muted' }, formatLongDate(d.fecha)),
    h('td', {}, h('span', { class: 'flex items-center justify-end gap-3' },
      h('button', {
        type: 'button', class: 'link-action',
        onclick: () => downloadFile(`/api/documentos/${d.id}/archivo`, d.nombre).catch((err) => toast(err.message, { type: 'error' })),
      }, 'Descargar'),
      h('button', { type: 'button', class: 'link-action', onclick: () => onOpen(d.paciente.id, 'docs') }, 'Ver ficha', icon('arrow-right', 'icon-sm')),
    )),
  )) : [h('tr', {}, h('td', { colspan: '5', class: 'py-10 text-muted' }, 'Todavía no hay documentos cargados.'))]));

  const missing = state.pacientes.filter((p) => missingDocs(p).length).sort(byArrival);
  const list = document.getElementById('doc-missing');
  list.replaceChildren(...(missing.length ? missing.map((p) => h('li', {},
    h('button', { type: 'button', class: 'flex w-full items-start gap-3 rounded-xl border border-line p-3 text-justify hover:border-mist hover:bg-haze', onclick: () => onOpen(p.id, 'docs') },
      h('span', { class: 'grid size-8 flex-none place-items-center rounded-full bg-alert-soft text-alert' }, icon('alert', 'icon-sm')),
      h('span', { class: 'min-w-0' },
        h('span', { class: 'block font-display font-bold' }, p.nombre),
        h('span', { class: 'block text-[0.8125rem] text-muted' }, `Falta: ${missingDocs(p).map((t) => DOC_TIPOS[t].toLowerCase()).join(' y ')}`),
      ),
    ),
  )) : [h('li', { class: 'flex items-center gap-2 text-sm text-muted' }, icon('check', 'icon-sm text-azure'), 'Todos los pacientes tienen sus documentos.')]));
}

/* ---------- Configuración: catálogos de sedes, tratamientos y hoteles ---------- */
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const countPatients = (fn) => plural(state.pacientes.filter(fn).length, 'paciente', 'pacientes');

function catalogRow({ iconName, title, meta, deleteLabel, onDelete }) {
  return h('li', { class: 'flex items-center gap-3 py-3' },
    h('span', { class: 'grid size-9 flex-none place-items-center rounded-lg bg-haze text-azure' }, icon(iconName, 'icon-sm')),
    h('div', { class: 'min-w-0 flex-1' },
      h('p', { class: 'truncate font-display font-bold' }, title),
      h('p', { class: 'text-[0.8125rem] text-muted' }, meta),
    ),
    h('button', { type: 'button', class: 'btn-icon size-9 flex-none text-alert', 'aria-label': deleteLabel, onclick: onDelete },
      icon('trash', 'icon-sm')),
  );
}

const emptyRow = (text) => h('li', { class: 'py-4 text-sm text-muted' }, text);

function renderCatalog({ key, items, iconName, empty, toRow }) {
  document.getElementById(`count-${key}`).textContent = items.length;
  document.getElementById(`list-${key}`).replaceChildren(...(items.length
    ? items.map((item) => catalogRow({ iconName, ...toRow(item) }))
    : [emptyRow(empty)]));
}

async function confirmRemoval(tipo, nombre, remove) {
  const ok = await confirmDialog({
    title: `¿Eliminar ${tipo}?`,
    text: `${nombre} dejará de aparecer como opción. Los pacientes que ya lo tienen asignado no cambian.`,
    confirmLabel: 'Eliminar',
  });
  if (!ok) return;
  const error = await remove();
  toast(error ?? `${nombre} se eliminó de la lista.`, { type: error ? 'error' : 'success' });
}

export function renderSettings() {
  renderCatalog({
    key: 'sedes', items: sedes(), iconName: 'pin', empty: 'Todavía no hay sedes.',
    toRow: (s) => ({
      title: s.nombre,
      meta: countPatients((p) => p.sede === s.id),
      deleteLabel: `Eliminar sede ${s.nombre}`,
      onDelete: async () => {
        const n = patientsInSede(s.id);
        if (n) {
          toast(`No se puede eliminar ${s.nombre}: tiene ${plural(n, 'paciente asignado', 'pacientes asignados')}.`, { type: 'error' });
          return;
        }
        const ok = await confirmDialog({
          title: '¿Eliminar sede?',
          text: `${s.nombre} dejará de aparecer en los filtros y en las fichas.`,
          confirmLabel: 'Eliminar',
        });
        if (!ok) return;
        const error = await removeSede(s.id);
        toast(error ?? `${s.nombre} se eliminó de la lista.`, { type: error ? 'error' : 'success' });
      },
    }),
  });
  renderCatalog({
    key: 'tratamientos', items: state.catalogos.tratamientos, iconName: 'check', empty: 'Todavía no hay tratamientos.',
    toRow: (t) => ({
      title: t.nombre,
      meta: [formatPrice(t.precio, t.moneda), tripsLabel(t.viajes), t.arcos ? `Por arcos (${archLabel(t.arcos)})` : null,
        countPatients((p) => p.tratamiento === t.nombre)].filter(Boolean).join(' · '),
      deleteLabel: `Eliminar tratamiento ${t.nombre}`,
      onDelete: () => confirmRemoval('tratamiento', t.nombre, () => removeTratamiento(t.id)),
    }),
  });
  renderCatalog({
    key: 'hoteles', items: state.catalogos.hoteles, iconName: 'bed', empty: 'Todavía no hay hoteles.',
    toRow: (hotel) => ({
      title: hotel.nombre,
      meta: countPatients((p) => p.hotel?.nombre === hotel.nombre),
      deleteLabel: `Eliminar hotel ${hotel.nombre}`,
      onDelete: () => confirmRemoval('hotel', hotel.nombre, () => removeHotel(hotel.id)),
    }),
  });
  renderVuelos();
}

// Vuelos: se muestran como fichas compactas agrupadas por tipo.
function renderVuelos() {
  document.getElementById('count-vuelos').textContent = state.catalogos.vuelos.length;
  document.getElementById('list-vuelos').replaceChildren(...Object.entries(TIPOS_VUELO).map(([tipo, label]) => {
    const vuelos = vuelosPorTipo(tipo);
    return h('li', { class: 'py-3' },
      h('p', { class: 'eyebrow' }, `${label} · ${vuelos.length}`),
      vuelos.length
        ? h('ul', { class: 'mt-2 flex flex-wrap gap-2' }, vuelos.map((v) => h('li', {
          class: 'flex items-center gap-1 rounded-lg border border-line bg-white py-1 pr-1 pl-3 font-display text-sm font-bold',
        },
        rutaVuelo(v),
        v.precio !== null ? h('span', { class: 'font-body font-normal text-muted' }, `· ${formatPrice(v.precio, v.moneda)}`) : null,
        h('button', {
          type: 'button', class: 'grid size-7 place-items-center rounded-md text-muted hover:bg-alert-soft hover:text-alert',
          'aria-label': `Eliminar vuelo ${rutaVuelo(v)}`,
          onclick: () => confirmRemoval('vuelo', rutaVuelo(v), () => removeVuelo(v.id)),
        }, icon('x', 'icon-sm')),
        )))
        : h('p', { class: 'mt-2 text-sm text-muted' }, `Sin vuelos de tipo ${label.toLowerCase()}.`),
    );
  }));
}

// Códigos IATA de 3 letras en mayúscula; nombres de aeródromo (p. ej. Cóbano) se respetan.
const cleanAirport = (value) => {
  const v = value.trim().replace(/\s+/g, ' ');
  return /^[a-z]{3}$/i.test(v) ? v.toUpperCase() : v;
};

function onCatalogSubmit(formId, add) {
  const form = document.getElementById(formId);
  const input = form.querySelector('input');
  const button = form.querySelector('[type="submit"]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    const { error, message } = await add(form).finally(() => { button.disabled = false; });
    if (error) {
      toast(error, { type: 'error' });
    } else {
      const keep = [...form.querySelectorAll('select')].map((s) => [s, s.value]);
      form.reset();
      keep.forEach(([s, v]) => { s.value = v; });
      toast(message);
    }
    input.focus();
  });
}

const nameOf = (form) => form.elements.nombre.value.trim().replace(/\s+/g, ' ');
const NEED_NAME = 'Escribí un nombre antes de agregarlo.';

// La casilla "Por arcos" habilita la elección de 1 o 2 arcos.
function setupArchToggle() {
  const form = document.getElementById('form-tratamiento');
  const sync = () => {
    const on = form.elements.porArcos.checked;
    form.elements.arcos.disabled = !on;
    form.querySelector('[data-arcos-field]').classList.toggle('opacity-50', !on);
  };
  form.elements.porArcos.addEventListener('change', sync);
  form.addEventListener('reset', () => setTimeout(sync));
  sync();
}

// Cada sección de Configuración es un botón (pestaña); solo se muestra la elegida.
function setupConfigTabs() {
  const tabs = [...document.querySelectorAll('#cfg-tabs [role="tab"]')];
  const select = (tab, focus = false) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      select(tabs[(i + step + tabs.length) % tabs.length], true);
    });
  });
}

export function setupSettings() {
  setupConfigTabs();
  setupArchToggle();
  onCatalogSubmit('form-sede', async (form) => {
    const nombre = nameOf(form);
    return { error: nombre ? await addSede(nombre) : NEED_NAME, message: `Sede ${nombre} agregada.` };
  });
  onCatalogSubmit('form-tratamiento', async (form) => {
    const nombre = nameOf(form);
    const precio = Number(form.elements.precio.value);
    if (!nombre) return { error: NEED_NAME };
    if (form.elements.precio.value === '' || !Number.isFinite(precio) || precio < 0) {
      return { error: 'Escribí el precio del tratamiento (un número mayor o igual a 0).' };
    }
    const moneda = form.elements.moneda.value;
    const viajes = Number(form.elements.viajes.value) === 1 ? 1 : 2;
    const arcos = form.elements.porArcos.checked ? Number(form.elements.arcos.value) : null;
    const detalle = [formatPrice(precio, moneda), tripsLabel(viajes).toLowerCase(), arcos ? `por arcos, ${archLabel(arcos)}` : null];
    return {
      error: await addTratamiento(nombre, precio, moneda, viajes, arcos),
      message: `Tratamiento ${nombre} agregado (${detalle.filter(Boolean).join(' · ')}).`,
    };
  });
  onCatalogSubmit('form-hotel', async (form) => {
    const nombre = nameOf(form);
    return { error: nombre ? await addHotel(nombre) : NEED_NAME, message: `${nombre} agregado a la lista de hoteles.` };
  });
  onCatalogSubmit('form-vuelo', async (form) => {
    const origen = cleanAirport(form.elements.origen.value);
    const destino = cleanAirport(form.elements.destino.value);
    if (!origen || !destino) return { error: 'Escribí el código del aeropuerto de origen y de destino.' };
    // Precio opcional: vacío = sin precio.
    const rawPrecio = form.elements.precio.value.trim();
    const precio = rawPrecio === '' ? null : Number(rawPrecio);
    if (precio !== null && (!Number.isFinite(precio) || precio < 0)) {
      return { error: 'El precio del vuelo debe ser un número mayor o igual a 0, o quedar vacío.' };
    }
    const tipo = form.elements.tipo.value;
    const moneda = form.elements.moneda.value;
    const conPrecio = precio === null ? '' : ` (${formatPrice(precio, moneda)})`;
    return {
      error: await addVuelo(tipo, origen, destino, precio, moneda),
      message: `Vuelo ${TIPOS_VUELO[tipo].toLowerCase()} ${origen} → ${destino} agregado${conPrecio}.`,
    };
  });
}
