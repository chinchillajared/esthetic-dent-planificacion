#!/bin/sh
# Aplica las migraciones y los datos iniciales antes de arrancar la API.
set -eu
alembic upgrade head
python -m app.seed
exec "$@"
