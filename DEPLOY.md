# Deploy en un Droplet de DigitalOcean

Guía paso a paso para publicar el Planificador de pacientes en un servidor propio (Droplet) con HTTPS de Let's Encrypt, Auth0 y respaldos automáticos.

```
Internet ──► nginx :80/:443 ──┬── /api/* ──► backend (FastAPI) ──► db (PostgreSQL, red interna)
                              └── /*     ──► frontend (estático)
```

Todo corre con Docker Compose en el mismo Droplet. Solo nginx publica puertos (80 y 443); la base de datos no es accesible desde internet.

> En los ejemplos se usa el dominio `planificador.estheticdent.com` y la carpeta `/opt/planificador`. Reemplazalos por los tuyos.

---

## 0. Antes de empezar

Necesitás:

- [ ] Una cuenta de DigitalOcean.
- [ ] Un dominio o subdominio y acceso a su DNS (por ejemplo `planificador.estheticdent.com`).
- [ ] Auth0 configurado según [docs/auth0.md](docs/auth0.md) (dominio, audience y Client ID a mano).
- [ ] Opcional: la clave de AirLabs para el estado de vuelos.
- [ ] El código en un repositorio Git privado (GitHub, GitLab…). Si no lo tenés, en el paso 5 hay una alternativa con `rsync`.
- [ ] Una llave SSH en tu computadora (`ssh-keygen -t ed25519` si no tenés una).

---

## 1. Crear el Droplet

En DigitalOcean: **Create → Droplets**.

| Opción | Valor recomendado |
|---|---|
| Región | La más cercana a Costa Rica (por ejemplo, New York) |
| Imagen | **Ubuntu 24.04 LTS x64** |
| Tamaño | Basic · Regular · **2 GB RAM / 1 vCPU** como mínimo (la construcción de las imágenes necesita memoria) |
| Autenticación | **SSH Key** (no uses contraseña) |
| Backups | Activado (respaldo semanal de todo el Droplet, adicional a los nuestros) |
| Monitoring | Activado |
| Hostname | `planificador` |

Anotá la **IP pública** del Droplet.

---

## 2. Apuntar el dominio al Droplet

En el panel de DNS de tu dominio creá un registro:

| Tipo | Nombre | Valor | TTL |
|---|---|---|---|
| A | `planificador` | IP del Droplet | 300 |

(Si el Droplet tiene IPv6, agregá también un registro `AAAA`.)

Comprobá desde tu computadora que ya resuelve (puede tardar unos minutos):

```bash
nslookup planificador.estheticdent.com
```

---

## 3. Preparar el servidor (una sola vez)

Conectate como `root`:

```bash
ssh root@IP_DEL_DROPLET
```

### 3.1 Actualizar el sistema y crear un usuario sin privilegios

```bash
apt update && apt -y upgrade
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

### 3.2 Endurecer SSH

Editá `/etc/ssh/sshd_config` (o creá `/etc/ssh/sshd_config.d/99-seguridad.conf`) con:

```
PermitRootLogin no
PasswordAuthentication no
```

```bash
systemctl restart ssh
```

> Antes de cerrar la sesión de `root`, abrí otra terminal y verificá que entrás con `ssh deploy@IP_DEL_DROPLET`.

### 3.3 Firewall

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

> Docker publica sus puertos por fuera de `ufw`. En este proyecto solo nginx publica puertos (80 y 443), así que es seguro. Como capa extra podés crear un **Cloud Firewall** en DigitalOcean (Networking → Firewalls) con las mismas reglas.

### 3.4 Swap (evita que la construcción se quede sin memoria)

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 3.5 Actualizaciones de seguridad automáticas

```bash
apt -y install unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

Desde aquí en adelante trabajá como `deploy`:

```bash
exit
ssh deploy@IP_DEL_DROPLET
```

---

## 4. Instalar Docker

Instalación oficial de Docker Engine y el plugin de Compose:

```bash
sudo apt -y install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker deploy
```

Cerrá la sesión y volvé a entrar para que el grupo `docker` tenga efecto. Verificá:

```bash
docker run --rm hello-world
docker compose version
```

---

## 5. Copiar el proyecto

```bash
sudo mkdir -p /opt/planificador
sudo chown deploy:deploy /opt/planificador
```

**Opción A — desde Git (recomendada):**

```bash
git clone git@github.com:TU_ORGANIZACION/planificador-pacientes.git /opt/planificador
```

(Para un repositorio privado, agregá una *deploy key* de solo lectura en GitHub: `ssh-keygen -t ed25519` en el Droplet y pegá `~/.ssh/id_ed25519.pub` en *Settings → Deploy keys* del repositorio.)

**Opción B — copiar desde tu computadora con `rsync`:**

```bash
rsync -av --exclude node_modules --exclude dist --exclude .env --exclude others --exclude __pycache__ \
  ./ deploy@IP_DEL_DROPLET:/opt/planificador/
```

---

## 6. Configurar el `.env` de producción

```bash
cd /opt/planificador
cp .env.example .env
chmod 600 .env
openssl rand -hex 24   # copiá el resultado como POSTGRES_PASSWORD
nano .env
```

Valores para producción:

| Variable | Valor |
|---|---|
| `COMPOSE_PROJECT_NAME` | `planificador-pacientes` |
| `SERVER_NAME` | `planificador.estheticdent.com` |
| `ENVIRONMENT` | `production` |
| `NGINX_HTTP_PORT` / `NGINX_HTTPS_PORT` | `80` / `443` |
| `FORCE_HTTPS` | `false` **por ahora** (se activa en el paso 8, cuando ya hay certificado) |
| `POSTGRES_DB` / `POSTGRES_USER` | `planificador` |
| `POSTGRES_PASSWORD` | el valor de `openssl rand -hex 24` |
| `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_CLIENT_ID` | los de tu tenant ([docs/auth0.md](docs/auth0.md)) |
| `AUTH0_CONNECTION` | `email` (código de un solo uso por correo, sin contraseña) |
| `AUTH_DEV_BYPASS` | `false` (el backend no arranca con `true` en producción) |
| `SEED_DEMO` | `false` |
| `MAX_UPLOAD_MB` | `10` |
| `AIRLABS_API_KEY` | tu clave de AirLabs (opcional) |

> El `.env` contiene secretos (contraseña de la base, clave de AirLabs): nunca lo subas a Git ni lo compartas por chat.

---

## 7. Primer arranque

```bash
cd /opt/planificador
docker compose up -d --build
```

La primera vez tarda varios minutos: construye las imágenes, **corre las pruebas del backend** (si alguna falla, no se construye) y aplica las migraciones de la base.

Verificá:

```bash
docker compose ps                                   # los 4 servicios en "healthy"
curl http://planificador.estheticdent.com/healthz   # → ok
curl http://planificador.estheticdent.com/api/health
docker compose logs backend --tail 30
```

---

## 8. HTTPS con Let's Encrypt

### 8.1 Obtener el certificado

Con el sitio ya respondiendo por HTTP (paso 7):

```bash
cd /opt/planificador
docker compose --profile certbot run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d planificador.estheticdent.com \
  --email TU_CORREO@estheticdent.com --agree-tos --no-eff-email
```

Reiniciá nginx para que tome el certificado (lo detecta solo):

```bash
docker compose restart nginx
docker compose logs nginx | grep "Let's Encrypt"   # → Usando el certificado de Let's Encrypt…
```

### 8.2 Forzar HTTPS

En `.env` cambiá `FORCE_HTTPS=true` y aplicá:

```bash
docker compose up -d nginx
curl -I http://planificador.estheticdent.com     # → 301 hacia https://
curl -I https://planificador.estheticdent.com    # → 200, con Strict-Transport-Security
```

### 8.3 Renovación automática

Los certificados duran 90 días. Programá la renovación (solo renueva si faltan menos de 30 días):

```bash
mkdir -p ~/logs
crontab -e
```

Agregá:

```cron
17 3,15 * * * /opt/planificador/deploy/renew-certs.sh >> /home/deploy/logs/certbot.log 2>&1
```

Probá que la renovación funcionaría:

```bash
docker compose --profile certbot run --rm certbot renew --webroot -w /var/www/certbot --dry-run
```

---

## 9. Auth0 en producción

En la Application de Auth0 (**Settings**), agregá la URL de producción en:

- **Allowed Callback URLs**: `https://planificador.estheticdent.com`
- **Allowed Logout URLs**: `https://planificador.estheticdent.com`
- **Allowed Web Origins**: `https://planificador.estheticdent.com`

Entrá a `https://planificador.estheticdent.com`, iniciá sesión y verificá que en la barra lateral aparecen tu nombre y el botón de cerrar sesión (y **no** el aviso de «Modo desarrollo»).

---

## 10. Respaldos

### 10.1 Respaldo diario automático

`deploy/backup.sh` guarda la base (`pg_dump`) y los documentos de los pacientes en `/opt/planificador/backups`, y borra los de más de 14 días.

```bash
crontab -e
```

```cron
30 2 * * * /opt/planificador/deploy/backup.sh /opt/planificador/backups >> /home/deploy/logs/backup.log 2>&1
```

Probalo una vez a mano:

```bash
/opt/planificador/deploy/backup.sh
ls -lh /opt/planificador/backups
```

### 10.2 Copia fuera del servidor (recomendado)

Un respaldo que vive en el mismo Droplet no sirve si se pierde el Droplet. Opciones:

- **DigitalOcean Spaces** (almacenamiento S3) con `rclone`: `rclone copy /opt/planificador/backups spaces:esthetic-respaldos/planificador` en otra línea de cron.
- Descargarlos periódicamente a otra máquina: `rsync -av deploy@IP_DEL_DROPLET:/opt/planificador/backups/ ./respaldos/`.

> Los respaldos contienen datos personales y documentos de pacientes: guardalos cifrados y con acceso restringido.

### 10.3 Restaurar

```bash
cd /opt/planificador
docker compose stop backend

# Base de datos
docker compose cp backups/db-AAAAMMDD-HHMMSS.dump db:/tmp/restaurar.dump
docker compose exec db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner /tmp/restaurar.dump && rm /tmp/restaurar.dump'

# Documentos
docker compose start backend
docker compose exec -T backend sh -c 'tar -xzf - -C /data/uploads' < backups/documentos-AAAAMMDD-HHMMSS.tar.gz
```

---

## 11. Actualizar la aplicación

```bash
cd /opt/planificador
./deploy/backup.sh                 # siempre, antes de actualizar
git pull
docker compose up -d --build
docker compose ps
docker image prune -f              # libera espacio de imágenes viejas
```

Las migraciones de la base se aplican solas al arrancar el backend. Si una versión nueva falla, volvé a la anterior (`git checkout <versión anterior>` y `docker compose up -d --build`); si esa versión incluía una migración, restaurá el respaldo previo (paso 10.3).

---

## 12. Comandos útiles

| Para | Comando |
|---|---|
| Ver el estado de los servicios | `docker compose ps` |
| Ver logs (en vivo) | `docker compose logs -f backend` (o `nginx`, `db`, `frontend`) |
| Reiniciar un servicio | `docker compose restart backend` |
| Aplicar cambios del `.env` | `docker compose up -d` |
| Entrar a la base de datos | `docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'` |
| Espacio usado por Docker | `docker system df` |
| Espacio en disco | `df -h` |

---

## 13. Lista de verificación de seguridad

- [ ] `ENVIRONMENT=production`, `AUTH_DEV_BYPASS=false`, `SEED_DEMO=false`.
- [ ] `POSTGRES_PASSWORD` larga y aleatoria; `.env` con permisos `600`.
- [ ] HTTPS funcionando con Let's Encrypt y `FORCE_HTTPS=true`.
- [ ] SSH solo con llave; `root` sin acceso por SSH.
- [ ] Firewall con solo 22, 80 y 443 abiertos.
- [ ] Auth0 solo con la conexión Passwordless Email, *Disable Sign Ups* activado y proveedor de correo propio configurado.
- [ ] Respaldo diario funcionando y copiado fuera del Droplet.
- [ ] Renovación de certificados programada (`--dry-run` exitoso).
- [ ] `/api/docs` no responde en producción (`curl -I https://planificador.estheticdent.com/api/docs` → 404).

---

## Solución de problemas

| Síntoma | Causa probable y solución |
|---|---|
| `502 Bad Gateway` | El backend no está sano: `docker compose logs backend`. Revisá `DATABASE_URL`/contraseñas del `.env`. |
| El backend no arranca: «AUTH_DEV_BYPASS solo se permite con ENVIRONMENT=development» | Poné `AUTH_DEV_BYPASS=false` en producción. |
| La construcción se corta (*Killed*) | Falta memoria: verificá el swap (paso 3.4) o usá un Droplet más grande. |
| `certbot` falla con *Connection refused* o *NXDOMAIN* | El DNS todavía no apunta al Droplet o el puerto 80 está cerrado (pasos 2 y 3.3). |
| La pantalla dice «El inicio de sesión todavía no está configurado» | Faltan `AUTH0_DOMAIN`, `AUTH0_AUDIENCE` o `AUTH0_CLIENT_ID` en `.env`; después `docker compose up -d`. |
| Auth0 muestra «Callback URL mismatch» | Falta la URL de producción en la Application de Auth0 (paso 9). |
| El estado de vuelo dice «Sin conexión a AirLabs» | Falta `AIRLABS_API_KEY` en `.env`; después `docker compose up -d backend`. |
| El navegador avisa que el certificado no es válido | Todavía se usa el autofirmado: repetí el paso 8.1 y reiniciá nginx. |

---

## Pendiente

- **Monitoreo con Netdata** (requerimiento de la segunda fase): todavía no está integrado. Mientras tanto, el *Monitoring* de DigitalOcean muestra CPU, memoria y disco del Droplet, y se pueden crear alertas desde su panel.
