#!/bin/sh
# Genera los snippets de nginx y elige el certificado TLS (Let's Encrypt o autofirmado).
set -eu

mkdir -p /etc/nginx/snippets /etc/nginx/certs

cat > /etc/nginx/snippets/proxy.conf <<'CONF'
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_hide_header Server;
CONF

# ---- Encabezados de seguridad. La CSP permite el dominio de Auth0 para iniciar sesión. ----
AUTH0_SRC=""
if [ -n "${AUTH0_DOMAIN:-}" ]; then
  # Solo se aceptan caracteres válidos de un dominio (evita inyectar directivas en el encabezado).
  if printf '%s' "$AUTH0_DOMAIN" | grep -Eq '^[A-Za-z0-9.-]+$'; then
    AUTH0_SRC=" https://${AUTH0_DOMAIN}"
  else
    echo "AUTH0_DOMAIN no es un dominio válido; se ignora en la CSP." >&2
  fi
fi
FRAME_SRC="'none'"
[ -n "$AUTH0_SRC" ] && FRAME_SRC="${AUTH0_SRC# }"

cat > /etc/nginx/snippets/security-headers.conf <<CONF
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'${AUTH0_SRC}; frame-src ${FRAME_SRC}; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
CONF

# ---- Rutas: /api al backend (FastAPI), el resto al frontend estático ----
cat > /etc/nginx/snippets/locations.conf <<'CONF'
location /api/ {
    limit_req zone=api burst=30 nodelay;
    limit_conn perip 20;
    client_max_body_size 12m;
    proxy_pass http://backend;
    include /etc/nginx/snippets/proxy.conf;
    proxy_read_timeout 60s;
    proxy_request_buffering on;
}

location / {
    limit_req zone=general burst=40 nodelay;
    limit_conn perip 30;
    proxy_pass http://frontend;
    include /etc/nginx/snippets/proxy.conf;
}
CONF

if [ "${FORCE_HTTPS:-false}" = "true" ]; then
  # /healthz (healthcheck interno) y la validación de Let's Encrypt quedan en HTTP.
  cat > /etc/nginx/snippets/https-redirect.conf <<'CONF'
if ($request_uri !~ "^/(healthz$|\.well-known/acme-challenge/)") {
    return 301 https://$host$request_uri;
}
CONF
else
  : > /etc/nginx/snippets/https-redirect.conf
fi

# ---- Certificado TLS: Let's Encrypt si existe; si no, uno autofirmado (solo desarrollo) ----
DOMINIO="${SERVER_NAME%% *}"
LE_DIR="/etc/letsencrypt/live/${DOMINIO}"
if [ -s "$LE_DIR/fullchain.pem" ] && [ -s "$LE_DIR/privkey.pem" ]; then
  echo "Usando el certificado de Let's Encrypt para ${DOMINIO}"
  cat > /etc/nginx/snippets/ssl-cert.conf <<CONF
ssl_certificate     ${LE_DIR}/fullchain.pem;
ssl_certificate_key ${LE_DIR}/privkey.pem;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
CONF
else
  if [ ! -s /etc/nginx/certs/fullchain.pem ] || [ ! -s /etc/nginx/certs/privkey.pem ]; then
    echo "Generando certificado autofirmado para ${DOMINIO:-localhost} (solo desarrollo)"
    openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
      -subj "/CN=${DOMINIO:-localhost}" \
      -keyout /etc/nginx/certs/privkey.pem \
      -out /etc/nginx/certs/fullchain.pem >/dev/null 2>&1
  fi
  # Sin HSTS: un certificado autofirmado no debe quedar "fijado" en los navegadores.
  cat > /etc/nginx/snippets/ssl-cert.conf <<'CONF'
ssl_certificate     /etc/nginx/certs/fullchain.pem;
ssl_certificate_key /etc/nginx/certs/privkey.pem;
CONF
fi
