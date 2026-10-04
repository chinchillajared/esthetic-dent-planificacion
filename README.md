# Planificador de pacientes · Esthetic Dent International

Web app interna para el seguimiento de pacientes internacionales: vuelos, traslados, hospedaje,
sede, tratamiento, documentos y pagos.

## Arquitectura

```
nginx (80/443) ──┬── /api/*  → backend  (FastAPI :8000) ── db (PostgreSQL :5432, red interna)
                 └── /*      → frontend (archivos estáticos :3000)
```

| Carpeta | Contenido |
|---|---|
| `frontend/` | HTML5 + Tailwind CSS v4 + JavaScript (módulos ES). Inicio de sesión en la propia pantalla: correo → código de un solo uso (sin contraseña). |
| `backend/` | FastAPI + SQLAlchemy 2 + Alembic. Pide y canjea el código con Auth0 (Regular Web Application), valida los tokens y guarda los documentos en un volumen privado. |
| `db/` | Configuración inicial de PostgreSQL (`db/init`). |
| `nginx/` | Proxy inverso: TLS (Let's Encrypt o autofirmado), encabezados de seguridad (CSP), límite de solicitudes por IP. |
| `deploy/` | Scripts de operación: `backup.sh` (base + documentos) y `renew-certs.sh` (Let's Encrypt). |
| `docs/` | Guías — [configurar Auth0](docs/auth0.md). |

**Publicar en producción:** ver [DEPLOY.md](DEPLOY.md) (Droplet de DigitalOcean, HTTPS, respaldos y actualizaciones).

## Levantar el proyecto (local)

1. Copiá `.env.example` a `.env` y completá los valores (el `.env` es obligatorio).
2. Configurá Auth0 siguiendo [docs/auth0.md](docs/auth0.md).
3. Construí y levantá los contenedores:

```bash
docker compose up -d --build
```

4. Abrí `http://localhost:<NGINX_HTTP_PORT>` o `https://localhost:<NGINX_HTTPS_PORT>` (en local nginx usa un certificado autofirmado, por eso el navegador muestra una advertencia en HTTPS).

Al arrancar, el backend aplica las migraciones (`alembic upgrade head`) y crea los catálogos iniciales si la base está vacía. Con `SEED_DEMO=true` también carga pacientes de demostración.

### Desarrollo sin Auth0

Mientras Auth0 no está configurado se puede usar `ENVIRONMENT=development` + `AUTH_DEV_BYPASS=true`: la API no pide token y la barra lateral muestra un aviso de «Modo desarrollo». El backend se niega a arrancar si esta opción se usa en producción.

## API

Todas las rutas (salvo `/api/health` y `/api/config/auth`) requieren `Authorization: Bearer <token de Auth0>`.

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/catalogos` | Sedes, tratamientos, hoteles y vuelos |
| POST / DELETE | `/api/sedes`, `/api/tratamientos`, `/api/hoteles`, `/api/vuelos` | Administrar catálogos |
| GET / POST | `/api/pacientes` | Listar y crear pacientes |
| GET / PUT / DELETE | `/api/pacientes/{id}` | Ver, actualizar y eliminar |
| PATCH | `/api/pacientes/{id}/etapa` | Etapa del viaje fijada a mano (`null` = automática) |
| POST | `/api/pacientes/{id}/comentarios` | Agregar comentario (autor = usuario del token) |
| POST | `/api/pacientes/{id}/documentos` | Subir PDF/JPG/PNG (máx. `MAX_UPLOAD_MB`) |
| PATCH / DELETE | `/api/documentos/{id}` | Cambiar tipo o eliminar |
| GET | `/api/documentos/{id}/archivo` | Descargar |

Con `ENVIRONMENT=development` la documentación interactiva está en `/api/docs`.

## Estado de vuelos (AirLabs)

Con `AIRLABS_API_KEY` en el `.env`, cada tramo con número de vuelo muestra «Estado: …» (a tiempo, atrasado, en vuelo, aterrizó, cancelado).

- La consulta es **manual**: el botón ⟳ junto al estado consulta AirLabs en ese momento. Al abrir la app solo se muestra el último estado guardado (no gasta consultas).
- El botón aparece desde 8 h antes hasta 6 h después de la hora del tramo, porque AirLabs responde por el vuelo de *hoy* con ese número. Antes se ve «Programado» y después «Finalizado».
- Dos clics seguidos sobre el mismo vuelo (menos de 1 minuto) no gastan otra consulta.
- La clave nunca llega al navegador.

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/estado-vuelos` | Último estado guardado de cada tramo (no consulta AirLabs) |
| POST | `/api/estado-vuelos/actualizar` | `{ "pacienteId", "tramo" }` → consulta AirLabs para ese tramo |

## Calidad

```bash
# Frontend: ESLint + validación de HTML + build
cd frontend && npm install && npm run check && npm run build

# Backend: pruebas (también se ejecutan en cada build de la imagen)
docker build --target test backend
```

## Seguridad

- **SQL injection**: todas las consultas usan el ORM (parámetros enlazados); las entradas se validan con Pydantic (longitudes, formatos, valores permitidos).
- **XSS**: el frontend inserta datos solo como texto (`textContent`), con CSP estricta (`script-src 'self'`).
- **Control de acceso**: toda la API exige un token válido de Auth0 (firma RS256, emisor, audiencia y vencimiento). El refresh token vive en una cookie `HttpOnly` + `SameSite=Strict`; el access token, solo en memoria.
- **Rate limiting**: nginx limita solicitudes y conexiones por IP (más estricto en `/api`).
- **Documentos**: se valida extensión, tamaño y firma del contenido; se guardan con nombre aleatorio fuera del sitio público y se descargan como adjunto.
- **Base de datos**: solo accesible desde la red interna de Docker, sin puertos publicados.

## Variables de entorno

| Variable | Uso |
|---|---|
| `COMPOSE_PROJECT_NAME` | Prefijo de contenedores, redes y volúmenes |
| `SERVER_NAME` | Dominio que atiende nginx (también el del certificado de Let's Encrypt) |
| `ENVIRONMENT` | `production` o `development` (`development` habilita `/api/docs`) |
| `NGINX_HTTP_PORT` / `NGINX_HTTPS_PORT` | Puertos publicados en el host |
| `FORCE_HTTPS` | `true` redirige HTTP → HTTPS (con certificado real) |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | Base de datos |
| `AUTH0_DOMAIN` / `AUTH0_AUDIENCE` / `AUTH0_CLIENT_ID` | Inicio de sesión ([docs/auth0.md](docs/auth0.md)) |
| `AUTH0_CLIENT_SECRET` | Secreto de la Regular Web Application (solo el backend) |
| `AUTH0_CONNECTION` | `email`: inicio de sesión con código por correo, sin contraseña |
| `AUTH_DEV_BYPASS` | Solo desarrollo: desactiva el login |
| `SEED_DEMO` | Carga pacientes de demostración en una base vacía |
| `MAX_UPLOAD_MB` | Tamaño máximo por documento |
| `AIRLABS_API_KEY` | Estado de vuelos (secreta; solo la usa el backend) |

## Respaldos

```bash
./deploy/backup.sh            # base de datos + documentos en ./backups (conserva 14 días)
```

Programación diaria, copia fuera del servidor y restauración: ver [DEPLOY.md](DEPLOY.md#10-respaldos).

## Pendiente

- Monitoreo con Netdata (segunda fase).
