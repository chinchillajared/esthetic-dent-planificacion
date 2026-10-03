# Configurar Auth0

El planificador usa Auth0 para el inicio de sesión. El frontend obtiene un *access token* (flujo Authorization Code + PKCE) y el backend lo valida en cada solicitud (firma RS256, emisor, audiencia y vencimiento).

Necesitás crear tres cosas en Auth0: una **API**, una **Application** tipo *Single Page Application* y una **Action** para incluir el nombre del usuario en el token.

> Reemplazá `https://planificador.estheticdent.com` por el dominio real. Para pruebas locales en esta máquina el sitio corre en `http://localhost:8081`.

## 1. Crear el tenant

1. Entrá a <https://manage.auth0.com> y creá una cuenta o tenant (por ejemplo `esthetic-dent`).
2. Elegí la región más cercana (US) — el dominio queda como `esthetic-dent.us.auth0.com`.

## 2. Crear la API

**Applications → APIs → Create API**

| Campo | Valor |
|---|---|
| Name | Planificador de pacientes |
| Identifier | `https://api.planificador.estheticdent` (es solo un identificador; no tiene que existir) |
| Signing Algorithm | RS256 |

Luego, en la pestaña **Settings** de la API:

- **Allow Offline Access**: activado (necesario para los *refresh tokens*).
- **Token Expiration**: 3600 segundos (1 hora) está bien.

## 3. Crear la Application (SPA)

**Applications → Applications → Create Application → Single Page Web Applications**

En **Settings**:

| Campo | Valor |
|---|---|
| Allowed Callback URLs | `https://planificador.estheticdent.com, http://localhost:8081` |
| Allowed Logout URLs | `https://planificador.estheticdent.com, http://localhost:8081` |
| Allowed Web Origins | `https://planificador.estheticdent.com, http://localhost:8081` |

En **Refresh Token Rotation**: activá **Rotation** (y dejá *Absolute Expiration* activado, por ejemplo 30 días).

En la pestaña **Connections**: dejá solo el método que use el equipo (por ejemplo *Username-Password-Authentication* o Google Workspace).

## 4. Solo usuarios invitados

El planificador tiene datos de pacientes; nadie debe poder registrarse por su cuenta.

1. **Authentication → Database → Username-Password-Authentication → Settings**: activá **Disable Sign Ups**.
2. Creá a cada persona del equipo en **User Management → Users → Create User** (o invitala).
3. Recomendado: **Security → Multi-factor Auth** → activar *One-time Password* o *Push*.

## 5. Action: nombre del usuario en el token

El backend registra quién escribe cada comentario y quién modifica cada paciente. Para eso el access token debe incluir el nombre.

**Actions → Library → Create Action → Build from scratch** (trigger: *Login / Post Login*):

```js
exports.onExecutePostLogin = async (event, api) => {
  const name = event.user.name || event.user.nickname || event.user.email;
  api.accessToken.setCustomClaim('https://esthetic-dent.app/name', name);
};
```

Hacé clic en **Deploy** y luego, en **Actions → Triggers → post-login**, arrastrala al flujo y **Apply**.

> Si cambiás el nombre del claim, actualizá también `AUTH0_NAME_CLAIM` en el backend (por defecto `https://esthetic-dent.app/name`).

## 6. Completar el `.env`

```dotenv
AUTH0_DOMAIN=esthetic-dent.us.auth0.com
AUTH0_AUDIENCE=https://api.planificador.estheticdent
AUTH0_CLIENT_ID=<Client ID de la Application SPA>
AUTH_DEV_BYPASS=false
```

Dominio, audience y Client ID **no son secretos** (el navegador los necesita). La Application SPA no usa *Client Secret*: no lo copies a ningún lado.

Aplicá los cambios:

```bash
docker compose up -d backend nginx
```

nginx agrega automáticamente el dominio de Auth0 a la política de seguridad de contenido (CSP).

## Cómo funciona

- El frontend descarga `/api/config/auth`, inicia sesión con `auth0-spa-js` (servido desde el propio dominio) y guarda la sesión con *refresh tokens* rotativos.
- Cada llamada a `/api/...` lleva `Authorization: Bearer <token>`.
- El backend descarga las llaves públicas del tenant (`/.well-known/jwks.json`, en caché) y rechaza con `401` cualquier token vencido, de otra API, de otro tenant o mal firmado.
- `AUTH_DEV_BYPASS=true` desactiva la autenticación **solo** con `ENVIRONMENT=development`; en producción el backend se niega a arrancar con esa opción.
