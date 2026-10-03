// Cliente de la API: agrega el token de Auth0 y convierte los errores en mensajes legibles.
import { getToken, login } from './auth.js';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const GENERIC = {
  401: 'Tu sesión expiró. Iniciá sesión de nuevo.',
  403: 'No tenés permiso para hacer esto.',
  404: 'El registro ya no existe. Recargá la página.',
  413: 'El archivo es demasiado grande.',
  429: 'Demasiadas solicitudes seguidas. Esperá unos segundos e intentá de nuevo.',
};

async function request(method, path, { json, form } = {}) {
  const headers = { Accept: 'application/json' };
  let token;
  try {
    token = await getToken();
  } catch {
    // El refresh token expiró o fue revocado: hay que volver a iniciar sesión.
    await login();
    throw new ApiError(GENERIC[401], 401);
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }

  let res;
  try {
    res = await fetch(path, { method, headers, body });
  } catch {
    throw new ApiError('No se pudo conectar con el servidor. Revisá tu conexión.', 0);
  }

  if (res.status === 204) return null;
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : null;
    throw new ApiError(detail || GENERIC[res.status] || 'Ocurrió un error en el servidor. Intentá de nuevo.', res.status);
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, json) => request('POST', path, { json }),
  put: (path, json) => request('PUT', path, { json }),
  patch: (path, json) => request('PATCH', path, { json }),
  del: (path) => request('DELETE', path),
  upload: (path, form) => request('POST', path, { form }),
};

/** Descarga un archivo protegido (con token) y lo entrega al navegador con su nombre. */
export async function downloadFile(path, filename) {
  const token = await getToken().catch(() => null);
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(GENERIC[res.status] || 'No se pudo descargar el archivo.', res.status);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
