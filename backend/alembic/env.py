"""Migraciones: la URL de la base se toma de DATABASE_URL (misma configuración que la API)."""
from alembic import context

from app import models  # noqa: F401 — registra las tablas en Base.metadata
from app.db import Base, engine

target_metadata = Base.metadata


def run_migrations_online() -> None:
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
