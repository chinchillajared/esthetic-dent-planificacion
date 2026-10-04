// Punto de entrada: navegación entre vistas, filtros y sincronización con el estado.
import { currentUser, initAuth, isDevMode, logout, requestCode, verifyCode } from './modules/auth.js';
import { formatMonth, h, initials } from './modules/dom.js';
import { loadFlightStatus } from './modules/flight-status.js';
import { openFicha, refreshCatalogOptions } from './modules/ficha.js';
import {
  arrivalDate, byArrival, currentStage, hasPendingPayments, hasUnconfirmedLegs, loadAll, matchesQuery, missingDocs, monthKey, sedes, state,
  subscribe, tripMonths,
} from './modules/store.js';
import { setupStageDrag } from './modules/stage-drag.js';
import { renderTrips } from './modules/trips.js';
import { installErrorHandlers, toast } from './modules/ui.js';
import { renderDocuments, renderPatients, renderSettings, setupSettings } from './modules/views.js';

installErrorHandlers();

const VIEWS = ['viajes', 'pacientes', 'documentos', 'configuracion'];
const TITLES = {
  viajes: 'Viajes',
  pacientes: 'Pacientes',
  documentos: 'Documentos',
  configuracion: 'Configuración',
};

const filtersForm = document.getElementById('trip-filters');
const monthSelect = document.getElementById('filter-mes');
const patientSearch = document.getElementById('patient-search');

/* ---------- Filtros de viajes ---------- */
function fillMonthOptions() {
  const previous = monthSelect.value;
  const keys = [...new Set(state.pacientes.flatMap(tripMonths))].sort();
  monthSelect.replaceChildren(
    h('option', { value: 'todos' }, 'Todos los meses'),
    ...keys.map((k) => {
      const [y, m] = k.split('-').map(Number);
      return h('option', { value: k }, formatMonth(y, m - 1));
    }),
  );
  if (previous && [...monthSelect.options].some((o) => o.value === previous)) {
    monthSelect.value = previous;
  } else {
    // Por defecto: el mes en curso si tiene pacientes; si no, el del próximo paciente en llegar.
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const next = [...state.pacientes].sort(byArrival).find((p) => arrivalDate(p) >= now);
    if (keys.includes(thisMonth)) monthSelect.value = thisMonth;
    else monthSelect.value = next ? monthKey(next) : 'todos';
  }
}

function fillSedeOptions() {
  const select = document.getElementById('filter-sede');
  const previous = select.value;
  select.replaceChildren(
    h('option', { value: 'todas' }, 'Todas'),
    ...sedes().map((s) => h('option', { value: s.id }, s.nombre)),
  );
  select.value = sedes().some((s) => s.id === previous) ? previous : 'todas';
}

function filteredTrips() {
  const f = Object.fromEntries(new FormData(filtersForm));
  const now = new Date();
  const in14 = new Date(now.getTime() + 14 * 86_400_000);
  return state.pacientes
    .filter((p) => f.mes === 'todos' || tripMonths(p).includes(f.mes))
    .filter((p) => f.sede === 'todas' || p.sede === f.sede)
    .filter((p) => matchesQuery(p, f.q))
    .filter((p) => {
      if (f.vista === 'pendientes') return hasPendingPayments(p);
      if (f.vista === 'por-confirmar') return hasUnconfirmedLegs(p);
      if (f.vista === 'proximos') {
        const d = arrivalDate(p);
        return d && d >= now && d <= in14;
      }
      return true;
    })
    .sort(byArrival);
}

filtersForm.addEventListener('input', () => renderTrips(filteredTrips(), openFicha));
filtersForm.addEventListener('submit', (e) => e.preventDefault());
document.querySelector('[data-action="reset-filters"]').addEventListener('click', () => {
  filtersForm.reset();
  monthSelect.value = 'todos';
  renderTrips(filteredTrips(), openFicha);
});

patientSearch.addEventListener('input', () => renderPatients(patientSearch.value, openFicha));

/* ---------- Navegación ---------- */
const sidebar = document.getElementById('sidebar');
const scrim = document.getElementById('sidebar-scrim');
const menuOpen = document.getElementById('menu-open');

function setMenu(open) {
  sidebar.classList.toggle('-translate-x-full', !open);
  scrim.hidden = !open;
  menuOpen.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('overflow-hidden', open);
  if (open) sidebar.querySelector('a, button')?.focus();
}
menuOpen.addEventListener('click', () => setMenu(true));
document.getElementById('menu-close').addEventListener('click', () => { setMenu(false); menuOpen.focus(); });
scrim.addEventListener('click', () => setMenu(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !scrim.hidden) { setMenu(false); menuOpen.focus(); }
});

const currentView = () => {
  const v = location.hash.slice(1);
  return VIEWS.includes(v) ? v : 'viajes';
};

function renderAll() {
  fillMonthOptions();
  fillSedeOptions();
  refreshCatalogOptions();
  renderSettings();
  renderTrips(filteredTrips(), openFicha);
  renderPatients(patientSearch.value, openFicha);
  renderDocuments(openFicha);
  document.querySelector('[data-count="pacientes"]').textContent = state.pacientes.length;
  const faltantes = state.pacientes.reduce((n, p) => n + missingDocs(p).length, 0);
  const badge = document.querySelector('[data-count="faltantes"]');
  badge.textContent = faltantes;
  badge.hidden = faltantes === 0;
}

function showView({ focus = true } = {}) {
  const view = currentView();
  document.querySelectorAll('[data-view]').forEach((s) => { s.hidden = s.dataset.view !== view; });
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.title = `${TITLES[view]} · Esthetic Dent International`;
  setMenu(false);
  if (focus) document.getElementById('main').focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', () => showView());
document.querySelectorAll('[data-action="new-patient"]').forEach((b) => b.addEventListener('click', () => openFicha()));

/* ---------- Acceso: correo → código de un solo uso → datos → interfaz ---------- */
const authScreen = document.getElementById('auth-screen');
const appShell = document.getElementById('app-shell');
const authStatus = document.getElementById('auth-status');
const authText = document.getElementById('auth-text');
const authSpinner = document.getElementById('auth-spinner');
const retryButton = document.getElementById('auth-retry');
const emailForm = document.getElementById('login-email');
const codeForm = document.getElementById('login-code');
const resendButton = document.getElementById('login-resend');
document.getElementById('auth-year').textContent = String(new Date().getFullYear());

let loginEmail = '';
let resendTimer = null;

function showPanel(panel) {
  authScreen.hidden = false;
  appShell.hidden = true;
  authStatus.hidden = panel !== authStatus;
  emailForm.hidden = panel !== emailForm;
  codeForm.hidden = panel !== codeForm;
}

function showStatus(text, { retry = false } = {}) {
  showPanel(authStatus);
  authText.textContent = text;
  authSpinner.hidden = retry;
  retryButton.hidden = !retry;
}

function setError(form, message) {
  const box = form.querySelector('.auth-error');
  box.textContent = message ?? '';
  box.hidden = !message;
}

function setBusy(form, busy, label) {
  const button = form.querySelector('[type="submit"]');
  button.disabled = busy;
  if (label) button.textContent = label;
}

function showEmailStep(message = '') {
  showPanel(emailForm);
  setError(emailForm, message);
  emailForm.elements.email.value = loginEmail;
  emailForm.elements.email.focus();
}

// "Reenviar código" se habilita después de 30 segundos.
function startResendCountdown() {
  clearInterval(resendTimer);
  let left = 30;
  const tick = () => {
    resendButton.disabled = left > 0;
    resendButton.textContent = left > 0 ? `Reenviar código (${left})` : 'Reenviar código';
    left -= 1;
    if (left < -1) clearInterval(resendTimer);
  };
  tick();
  resendTimer = setInterval(tick, 1000);
}

function showCodeStep() {
  showPanel(codeForm);
  setError(codeForm, '');
  document.getElementById('login-email-shown').textContent = loginEmail;
  codeForm.elements.code.value = '';
  codeForm.elements.code.focus();
  startResendCountdown();
}

emailForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = emailForm.elements.email.value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    setError(emailForm, 'Escribí un correo electrónico válido.');
    emailForm.elements.email.focus();
    return;
  }
  setError(emailForm, '');
  setBusy(emailForm, true, 'Enviando código…');
  try {
    await requestCode(email);
    loginEmail = email;
    showCodeStep();
  } catch (err) {
    setError(emailForm, err.message);
  } finally {
    setBusy(emailForm, false, 'Continuar');
  }
});

// Solo dígitos; al completar los 6 se envía solo.
codeForm.elements.code.addEventListener('input', () => {
  const input = codeForm.elements.code;
  input.value = input.value.replace(/\D/g, '').slice(0, 6);
  if (input.value.length === 6) codeForm.requestSubmit();
});

codeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = codeForm.elements.code.value.trim();
  if (!/^\d{6}$/.test(code)) {
    setError(codeForm, 'Escribí los 6 dígitos del código.');
    return;
  }
  setError(codeForm, '');
  setBusy(codeForm, true, 'Verificando…');
  try {
    await verifyCode(loginEmail, code);
    clearInterval(resendTimer);
    await enterApp();
  } catch (err) {
    setError(codeForm, err.message);
    codeForm.elements.code.select();
  } finally {
    setBusy(codeForm, false, 'Entrar');
  }
});

resendButton.addEventListener('click', async () => {
  try {
    await requestCode(loginEmail);
    setError(codeForm, '');
    toast('Te enviamos un código nuevo.');
    startResendCountdown();
  } catch (err) {
    setError(codeForm, err.message);
  }
});

document.getElementById('login-change-email').addEventListener('click', () => {
  clearInterval(resendTimer);
  showEmailStep();
});

retryButton.addEventListener('click', () => start());

document.getElementById('logout').addEventListener('click', async () => {
  await logout();
  showEmailStep();
});

// La API respondió 401: la sesión venció o fue revocada.
window.addEventListener('auth:expired', () => {
  if (!appShell.hidden) showEmailStep('Tu sesión expiró. Iniciá sesión de nuevo.');
});

function showUser() {
  const user = currentUser() ?? {};
  const name = user.name || user.email || 'Usuario';
  const nameEl = document.getElementById('user-name');
  const emailEl = document.getElementById('user-email');
  nameEl.textContent = name;
  nameEl.title = name;
  emailEl.textContent = user.email && user.email !== name ? user.email : 'Esthetic Dent International';
  emailEl.title = emailEl.textContent;
  document.getElementById('user-initials').textContent = initials(name) || 'ED';
  document.getElementById('dev-mode-note').hidden = !isDevMode();
  document.getElementById('logout').hidden = isDevMode();
}

let started = false;

async function enterApp() {
  showStatus('Cargando pacientes…');
  try {
    if (!started) {
      subscribe(renderAll);
      setupSettings();
      setupStageDrag();
      started = true;
    }
    await loadAll();
  } catch (err) {
    showStatus(err.message, { retry: true });
    return;
  }

  showUser();
  authScreen.hidden = true;
  appShell.hidden = false;
  showView({ focus: false });
  watchStages();
  // Último estado guardado de los vuelos (no consulta AirLabs; eso es manual desde cada tramo).
  if (await loadFlightStatus()) renderAll();
}

async function start() {
  showStatus('Verificando tu sesión…');
  const auth = await initAuth();
  if (auth.status === 'login') {
    showEmailStep();
    return;
  }
  if (auth.status === 'sin-configurar') {
    showStatus('El inicio de sesión todavía no está configurado en el servidor. Pedile al administrador que complete los datos de Auth0.', { retry: true });
    return;
  }
  if (auth.status === 'error') {
    showStatus(auth.message, { retry: true });
    return;
  }
  await enterApp();
}

// Cada minuto revisa si algún paciente cambió de etapa y, solo en ese caso, vuelve a dibujar.
let stageTimer = null;
function watchStages() {
  if (stageTimer) return;
  const stageSignature = () => state.pacientes.map((p) => currentStage(p)?.key ?? '-').join('|');
  let lastStages = stageSignature();
  stageTimer = setInterval(() => {
    const next = stageSignature();
    if (next !== lastStages) {
      lastStages = next;
      renderAll();
    }
  }, 60_000);
}

start();
