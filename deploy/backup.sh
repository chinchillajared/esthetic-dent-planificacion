#!/bin/sh
# Respaldo de la base de datos y de los documentos de los pacientes.
# Uso: deploy/backup.sh [carpeta de destino]   (por defecto ./backups)
# Conserva los respaldos de los últimos RETENCION_DIAS días (14 por defecto).
set -eu
cd "$(dirname "$0")/.."

DESTINO="${1:-./backups}"
RETENCION_DIAS="${RETENCION_DIAS:-14}"
FECHA="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DESTINO"
chmod 700 "$DESTINO"

# Base de datos (formato custom de pg_dump: se restaura con pg_restore).
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > "$DESTINO/db-$FECHA.dump"

# Documentos subidos (volumen privado del backend).
docker compose exec -T backend tar -czf - -C /data/uploads . > "$DESTINO/documentos-$FECHA.tar.gz"

chmod 600 "$DESTINO/db-$FECHA.dump" "$DESTINO/documentos-$FECHA.tar.gz"
find "$DESTINO" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'documentos-*.tar.gz' \) -mtime +"$RETENCION_DIAS" -delete

echo "Respaldo listo: $DESTINO/db-$FECHA.dump y $DESTINO/documentos-$FECHA.tar.gz"
