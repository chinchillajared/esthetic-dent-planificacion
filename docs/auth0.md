# Configurar Auth0 (inicio de sesión con código por correo, sin contraseña)

El equipo inicia sesión escribiendo su correo y el **código de un solo uso (OTP)** que Auth0 le envía. No hay contraseñas.

El frontend obtiene un *access token* (flujo Authorization Code + PKCE) y el backend lo valida en cada solicitud (firma RS256, emisor, audiencia y vencimiento).

Vas a crear en Auth0: una **API**, una **Application**, la conexión **Passwordless Email**, un **proveedor de correo** y una **Action**.

> Reemplazá `https://planificador.estheticdent.com` por el dominio real. En local el sitio corre en `http://localhost:8081`.

## 1. Crear el tenant

1. Entrá a <https://auth0.com> y creá una cuenta (el plan gratuito alcanza).
2. Nombre del tenant, p. ej. `esthetic-dent`; región **US**.
3. Tu dominio queda como `esthetic-dent.us.auth0.com` → es `AUTH0_DOMAIN`.

## 2. Crear la API

**Applications → APIs → Create API**

| Campo | Valor |
|---|---|
| Name | Planificador de pacientes |
| Identifier | `https://api.planificador.estheticdent` (solo un identificador; no tiene que existir) → es `AUTH0_AUDIENCE` |
| Signing Algorithm | RS256 |

En la pestaña **Settings** de la API activá **Allow Offline Access** (necesario para mantener la sesión al recargar) y guardá.

## 3. Crear la Application

**Applications → Applications → Create Application → Single Page Web Applications**

1. En **Settings** copiá el **Client ID** → es `AUTH0_CLIENT_ID`. (El *Client Secret* no se usa.)
2. **Application URIs** (las dos direcciones separadas por coma):

   | Campo | Valor |
   |---|---|
   | Allowed Callback URLs | `http://localhost:8081, https://planificador.estheticdent.com` |
   | Allowed Logout URLs | `http://localhost:8081, https://planificador.estheticdent.com` |
   | Allowed Web Origins | `http://localhost:8081, https://planificador.estheticdent.com` |

3. **Refresh Token Rotation**: activá **Allow Refresh Token Rotation**.
4. **Save Changes**.

## 4. Activar el código por correo (Passwordless Email)

**Authentication → Passwordless → Email** (activá el interruptor y abrí la configuración).

En **Settings**:

| Campo | Valor |
|---|---|
| From | `Esthetic Dent <no-responder@estheticdent.com>` (no puede ser de `auth0.com`) |
| Subject | `Tu código para el Planificador de pacientes` |
| Message | Dejá la plantilla; contiene `{{ code }}` |
| OTP Expiry | `300` segundos (5 minutos) |
| OTP Length | `6` |
| Disable Sign Ups | **Activado** — solo entran usuarios creados por ustedes |

**Save**. En la pestaña **Applications** de esa misma ventana, activá **Planificador de pacientes**.

> Después de 3 códigos incorrectos hay que pedir uno nuevo.

### 4.1 Quitar las contraseñas

En **Applications → Applications → Planificador de pacientes → Connections**:

- **Desactivá** `Username-Password-Authentication` (y cualquier red social).
- Debe quedar activa **solo** la conexión `email`.

Además la app fuerza esa conexión con `AUTH0_CONNECTION=email`, así que nunca se muestra la pantalla de contraseña.

### 4.2 Pantalla de inicio de sesión

**Authentication → Authentication Profile** → elegí **Identifier First** y guardá.

## 5. Proveedor de correo (obligatorio en producción)

El correo que trae Auth0 de fábrica es solo para pruebas (envía pocos correos y puede caer en spam).

**Branding → Email Provider** → activá **Use my own email provider** y elegí uno:

- **SMTP** con el correo del dominio (Google Workspace, Microsoft 365, Zoho…), o
- un servicio de envío: SendGrid, Mailgun, Amazon SES, Postmark…

Completá los datos, enviá un **correo de prueba** y guardá. Usá la misma dirección del campo **From** del paso 4.

> Para que no llegue a spam, el proveedor te pedirá agregar registros SPF/DKIM en el DNS del dominio.

## 6. Crear a las personas del equipo

**User Management → Users → Create User**

- **Connection**: `email`
- **Email**: el correo de la persona

No hay contraseña que definir: la primera vez que entre, recibirá su código.

Para quitarle el acceso a alguien: abrí el usuario y usá **Block** (o **Delete**).

## 7. Action: nombre del usuario en el token

El backend registra quién escribe cada comentario y quién modifica cada paciente.

**Actions → Library → Create Action → Build from scratch** (trigger: *Login / Post Login*):

```js
exports.onExecutePostLogin = async (event, api) => {
  const name = event.user.name || event.user.nickname || event.user.email;
  api.accessToken.setCustomClaim('https://esthetic-dent.app/name', name);
};
```

**Deploy**. Luego en **Actions → Triggers → post-login** arrastrala entre *Start* y *Complete* y **Apply**.

> Con usuarios de correo sin contraseña, el nombre visible es el correo. Si querés que aparezca el nombre real, en **User Management → Users → (usuario)** editá **Name**.

## 8. Completar el `.env`

```dotenv
AUTH0_DOMAIN=esthetic-dent.us.auth0.com
AUTH0_AUDIENCE=https://api.planificador.estheticdent
AUTH0_CLIENT_ID=<Client ID de la Application>
AUTH0_CONNECTION=email
AUTH_DEV_BYPASS=false
```

Dominio, audience, Client ID y conexión **no son secretos**.

```bash
docker compose up -d backend nginx
```

## 9. Probar

1. Abrí el sitio → **Iniciar sesión**.
2. Auth0 pide solo el **correo** → llega un código de 6 dígitos → lo escribís.
3. Volvés a la app con tu nombre (o correo) abajo en la barra lateral y sin el aviso de «Modo desarrollo».
4. Recargá la página: la sesión se mantiene sin pedir otro código.

| Problema | Solución |
|---|---|
| Aparece la pantalla de contraseña | Revisá el paso 4.1 y que `AUTH0_CONNECTION=email` esté en `.env` (y repetí `docker compose up -d backend nginx`). |
| «Callback URL mismatch» | La dirección del sitio no está en el paso 3.2. |
| No llega el código | Revisá spam y el proveedor de correo (paso 5); usá *Send test email*. |
| «Signups disabled» / «user does not exist» | El correo no fue creado como usuario (paso 6). |
| Pide código en cada recarga | Falta **Allow Offline Access** (paso 2) o **Refresh Token Rotation** (paso 3.3). |
| En los comentarios aparece un código raro en vez del nombre | La Action del paso 7 no está en *Triggers → post-login*. |

## Cómo funciona

- El frontend descarga `/api/config/auth`, inicia sesión con `auth0-spa-js` (servido desde el propio dominio, conexión forzada `email`) y mantiene la sesión con *refresh tokens* rotativos.
- Cada llamada a `/api/...` lleva `Authorization: Bearer <token>`.
- El backend descarga las llaves públicas del tenant (`/.well-known/jwks.json`, en caché) y rechaza con `401` cualquier token vencido, de otra API, de otro tenant o mal firmado.
- `AUTH_DEV_BYPASS=true` desactiva la autenticación **solo** con `ENVIRONMENT=development`; en producción el backend se niega a arrancar con esa opción.
