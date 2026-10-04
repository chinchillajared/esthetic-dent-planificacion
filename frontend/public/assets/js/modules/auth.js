// Sesión: inicio con código de un solo uso por correo, dentro de la pantalla de la app.
// Con Auth0 habla el backend (/api/auth/*); el access token vive solo en memoria y la sesión
// se recupera al recargar con la cookie HttpOnly del refresh token.

let mode = 'auth0';
let accessToken = null;
let expiresAt = 0;
let refreshing = null;
let user = null;

const SAFETY_MS = 60_000; // renueva el token cuando le falta menos de un minuto

export class AuthError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function post(path, json) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new AuthError('No se pudo conectar con el servidor. Revisá tu conexión.', 0);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : 'No se pudo iniciar sesión. Intentá de nuevo.';
    throw new AuthError(detail, res.status);
  }
  return data;
}

function storeSession(session) {
  accessToken = session.accessToken;
  expiresAt = Date.now() + session.expiresIn * 1000;
}

async function loadUser() {
  const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  const me = res.ok ? await res.json() : {};
  user = { name: me.nombre || me.email || 'Usuario', email: me.email || '' };
}

/** Renueva el access token con la cookie (una sola renovación a la vez). */
function refresh() {
  refreshing ??= post('/api/auth/refresh')
    .then(storeSession)
    .finally(() => { refreshing = null; });
  return refreshing;
}

/**
 * Prepara la sesión al abrir la app:
 *  { status: 'ok' } · { status: 'login' } · { status: 'sin-configurar' } · { status: 'error', message }
 */
export async function initAuth() {
  let cfg;
  try {
    const res = await fetch('/api/config/auth', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cfg = await res.json();
  } catch {
    return { status: 'error', message: 'No se pudo conectar con el servidor. Revisá tu conexión e intentá de nuevo.' };
  }

  if (cfg.modo === 'desarrollo') {
    mode = 'dev';
    user = { name: 'Desarrollo local', email: 'Sin autenticación' };
    return { status: 'ok' };
  }
  if (cfg.modo !== 'auth0') return { status: 'sin-configurar' };

  try {
    await refresh();
    await loadUser();
    return { status: 'ok' };
  } catch (err) {
    if (err.status === 401) return { status: 'login' };
    return { status: 'error', message: err.message };
  }
}

/** Paso 1: Auth0 envía el código al correo. */
export function requestCode(email) {
  return post('/api/auth/code', { email });
}

/** Paso 2: canjea el código por la sesión. */
export async function verifyCode(email, code) {
  storeSession(await post('/api/auth/token', { email, code }));
  await loadUser();
  if (!user.email) user.email = email;
}

export const isDevMode = () => mode === 'dev';
export const currentUser = () => user;

export async function logout() {
  accessToken = null;
  expiresAt = 0;
  user = null;
  await post('/api/auth/logout').catch(() => {});
}

/** Access token vigente para la API; null en modo desarrollo. Lanza AuthError(401) si la sesión venció. */
export async function getToken() {
  if (mode === 'dev') return null;
  if (!accessToken || Date.now() > expiresAt - SAFETY_MS) await refresh();
  return accessToken;
}

/** Avisa a la app que la sesión venció (la API respondió 401). */
export function sessionExpired() {
  accessToken = null;
  expiresAt = 0;
  window.dispatchEvent(new CustomEvent('auth:expired'));
}
