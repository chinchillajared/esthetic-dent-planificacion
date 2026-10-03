// Inicio de sesión con Auth0 (Authorization Code + PKCE mediante auth0-spa-js).
// La configuración pública (dominio, Client ID y audience) la entrega el backend en /api/config/auth.

let client = null;
let mode = 'auth0';
let user = null;

/**
 * Prepara la sesión. Devuelve:
 *  { status: 'ok' }            sesión iniciada (o modo desarrollo)
 *  { status: 'login' }         hay que iniciar sesión
 *  { status: 'sin-configurar' } Auth0 todavía no está configurado en el servidor
 *  { status: 'error', message }
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

  const { createAuth0Client } = await import('../vendor/auth0-spa-js.js');
  client = await createAuth0Client({
    domain: cfg.domain,
    clientId: cfg.clientId,
    authorizationParams: { audience: cfg.audience, redirect_uri: window.location.origin },
    // Refresh tokens rotativos: la sesión sobrevive a recargas sin cookies de terceros.
    useRefreshTokens: true,
    cacheLocation: 'localstorage',
  });

  const params = new URLSearchParams(window.location.search);
  if (params.has('code') && params.has('state')) {
    try {
      const { appState } = await client.handleRedirectCallback();
      window.history.replaceState({}, document.title, `${window.location.pathname}${appState?.hash ?? ''}`);
    } catch {
      window.history.replaceState({}, document.title, window.location.pathname);
      return { status: 'error', message: 'No se pudo completar el inicio de sesión. Intentá de nuevo.' };
    }
  } else if (params.has('error')) {
    const message = params.get('error_description') || 'Auth0 rechazó el inicio de sesión.';
    window.history.replaceState({}, document.title, window.location.pathname);
    return { status: 'error', message };
  }

  if (!(await client.isAuthenticated())) return { status: 'login' };
  user = await client.getUser();
  return { status: 'ok' };
}

export const isDevMode = () => mode === 'dev';
export const currentUser = () => user;

export function login() {
  return client?.loginWithRedirect({ appState: { hash: window.location.hash } });
}

export function logout() {
  if (!client) return;
  client.logout({ logoutParams: { returnTo: window.location.origin } });
}

/** Access token para la API; null en modo desarrollo. */
export async function getToken() {
  if (mode === 'dev' || !client) return null;
  return client.getTokenSilently();
}
