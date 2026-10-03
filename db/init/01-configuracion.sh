#!/bin/sh
# Se ejecuta una sola vez, al crear el volumen de datos de PostgreSQL.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
-- Solo el dueño de la base puede crear objetos en el esquema público.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE "$POSTGRES_DB" FROM PUBLIC;
-- Fechas y horas en hora de Costa Rica.
ALTER DATABASE "$POSTGRES_DB" SET timezone TO 'America/Costa_Rica';
SQL
