# Configurar Auth0 (código por correo, sin contraseña, en la pantalla de la app)

El equipo inicia sesión **dentro del planificador**: escribe su correo, recibe un **código de 6 dígitos** y lo escribe en la misma pantalla. No hay contraseñas ni se pasa por la pantalla de Auth0.

Quien habla con Auth0 es el **backend**: pide el código (`/passwordless/start`) y lo canjea (grant *Passwordless OTP*) con la **client secret**, que nunca llega al navegador. Por eso la aplicación de Auth0 es de tipo **Regular Web Application** (Auth0 no permite ese canje en aplicaciones SPA).

La sesión: el *access token* vive solo en memoria del navegador y se renueva con el *refresh token*, que queda en una cookie `HttpOnly` (el JavaScript no puede leerla). Al recargar la página la sesión se recupera sola.

## 1. Tenant

<https://auth0.com> → creá el tenant (p. ej. `esthetic-dent`, región US). Tu dominio es `esthetic-dent.us.auth0.com` → `AUTH0_DOMAIN`.

## 2. API

**Applications → APIs → Create API**

| Campo | Valor |
|---|---|
| Name | Planificador de pacientes |
| Identifier | `https://api.planificador.estheticdent` → `AUTH0_AUDIENCE` |
| Signing Algorithm | RS256 |

En **Settings** de la API: activá **Allow Offline Access** (necesario para el refresh token). **Token Expiration**: `3600` (1 hora).

## 3. Application (Regular Web Application)

**Applications → Applications → Create Application → Regular Web Applications**

En **Settings**:

1. Copiá **Client ID** → `AUTH0_CLIENT_ID` y **Client Secret** → `AUTH0_CLIENT_SECRET`.
   > El Client Secret es **secreto**: va solo en el `.env` del servidor. Nunca en el código, en Git ni por chat.
2. **Refresh Token Rotation**: activá **Rotation**, con un **Rotation Overlap Period** de unos `10` segundos (varias pestañas abiertas no se pisan). Ajustá **Inactivity Expiration** / **Absolute Expiration** según cuánto debe durar la sesión (p. ej. 7 y 30 días).
3. **Advanced Settings → Grant Types**: marcá **Passwordless OTP** y **Refresh Token**.
4. **Save Changes**.

No hace falta completar *Allowed Callback URLs* ni *Logout URLs*: el navegador no va a Auth0.

## 4. Código por correo (Passwordless Email)

**Authentication → Passwordless → Email** → activalo.

| Campo | Valor |
|---|---|
| From | `Esthetic Dent <no-responder@estheticdentcr.com>` (no puede ser de `auth0.com`) |
| Subject | `Tu código para el Planificador de pacientes` |
| Message | Personalizá la plantilla (debe incluir `{{ code }}`) |
| OTP Expiry | `300` segundos |
| OTP Length | `6` |
| **Disable Sign Ups** | **Activado** — solo entran usuarios creados por ustedes |

**Save**. En la pestaña **Applications** activá **Planificador de pacientes**.

En la Application → pestaña **Connections**: dejá activa **solo** `email` (desactivá *Username-Password-Authentication*).

## 5. Proveedor de correo (obligatorio en producción)

El correo de fábrica de Auth0 es solo para pruebas. **Branding → Email Provider → Use my own email provider**: SMTP del dominio (Google Workspace, Microsoft 365…) o un servicio (SendGrid, Mailgun, Amazon SES…). Enviá un **correo de prueba** y guardá. Agregá los registros SPF/DKIM que pida el proveedor para no caer en spam.

## 6. Usuarios del equipo

**User Management → Users → Create User** → **Connection: email** → correo de la persona. Sin contraseña.

En el usuario podés completar **Name** (aparece en los comentarios). Para quitar el acceso: **Block** o **Delete**; además, el refresh token se puede revocar en **Users → (usuario) → Authorized Applications**.

## 7. Action: nombre y correo en el token

**Actions → Library → Create Action → Build from scratch** (trigger *Login / Post Login*):

```js
exports.onExecutePostLogin = async (event, api) => {
  const name = event.user.name || event.user.nickname || event.user.email;
  api.accessToken.setCustomClaim('https://esthetic-dent.app/name', name);
  api.accessToken.setCustomClaim('https://esthetic-dent.app/email', event.user.email);
};
```

**Deploy** → **Actions → Triggers → post-login**: arrastrala entre *Start* y *Complete* → **Apply**.

## 8. `.env`

```dotenv
AUTH0_DOMAIN=esthetic-dent.us.auth0.com
AUTH0_AUDIENCE=https://api.planificador.estheticdent
AUTH0_CLIENT_ID=<Client ID>
AUTH0_CLIENT_SECRET=<Client Secret>
AUTH0_CONNECTION=email
AUTH_DEV_BYPASS=false
```

```bash
docker compose up -d backend nginx
```

## 9. Probar

1. Abrí el sitio: aparece **Iniciar sesión** con el campo de correo.
2. **Continuar** → llega el código → escribilo (con los 6 dígitos entra solo).
3. Ves la app con tu nombre abajo en la barra lateral, sin el aviso de «Modo desarrollo».
4. Recargá: la sesión se mantiene. **Cerrar sesión** vuelve a la pantalla de correo.

| Mensaje en la pantalla | Solución |
|---|---|
| «El inicio de sesión todavía no está configurado…» | Falta alguna variable `AUTH0_*` (incluida la secret) en `.env`. |
| «Falta habilitar el grant Passwordless OTP…» | Paso 3.3. |
| «Auth0 rechazó las credenciales…» | Client ID o Client Secret mal copiados. |
| «Ese correo no tiene acceso al planificador…» | El correo no está creado como usuario (paso 6). |
| «El inicio de sesión por correo no está habilitado en Auth0» | Paso 4: Passwordless Email activo y habilitado para la aplicación. |
| No llega el código | Spam / proveedor de correo (paso 5). |
| «Se enviaron demasiados códigos…» | Máximo 5 códigos por correo cada 10 minutos: esperá un poco. |

## Rutas del backend

| Método y ruta | Uso |
|---|---|
| `GET /api/config/auth` | `{modo}`: `auth0`, `desarrollo` o `sin-configurar` |
| `POST /api/auth/code` | `{email}` → Auth0 envía el código (`204`) |
| `POST /api/auth/token` | `{email, code}` → `{accessToken, expiresIn}` + cookie `pp_refresh` |
| `POST /api/auth/refresh` | Renueva con la cookie → `{accessToken, expiresIn}` (`401` si venció) |
| `POST /api/auth/logout` | Revoca el refresh token en Auth0 y borra la cookie (`204`) |

`AUTH_DEV_BYPASS=true` desactiva el inicio de sesión **solo** con `ENVIRONMENT=development`; en producción el backend se niega a arrancar con esa opción.
