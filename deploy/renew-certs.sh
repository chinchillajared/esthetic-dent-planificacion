#!/bin/sh
# Renueva los certificados de Let's Encrypt (solo si vencen en menos de 30 días) y recarga nginx.
# Programarlo con cron dos veces al día (ver DEPLOY.md).
set -eu
cd "$(dirname "$0")/.."

docker compose --profile certbot run --rm certbot renew --webroot -w /var/www/certbot --quiet
docker compose exec -T nginx nginx -s reload
