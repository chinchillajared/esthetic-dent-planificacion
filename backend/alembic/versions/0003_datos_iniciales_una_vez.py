"""datos iniciales una sola vez

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-03 23:40:00

Antes, los catálogos de ejemplo se volvían a crear al reiniciar si la tabla quedaba vacía
(p. ej. al borrar todos los tratamientos). Ahora se registra que ya se cargaron.
"""
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    tabla = op.create_table(
        'datos_iniciales',
        sa.Column('clave', sa.String(length=40), nullable=False),
        sa.Column('aplicado_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('clave'),
    )
    # En una base que ya estaba en uso, los datos iniciales ya se cargaron: no se repiten.
    conn = op.get_bind()
    ahora = datetime.now(timezone.utc)
    filas = []
    if conn.scalar(sa.text('SELECT COUNT(*) FROM sedes')):
        filas.append({'clave': 'catalogos', 'aplicado_at': ahora})
    if conn.scalar(sa.text('SELECT COUNT(*) FROM pacientes')):
        filas.append({'clave': 'demo', 'aplicado_at': ahora})
    if filas:
        op.bulk_insert(tabla, filas)


def downgrade() -> None:
    op.drop_table('datos_iniciales')
