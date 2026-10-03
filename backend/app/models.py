"""Modelos de base de datos (SQLAlchemy 2.0)."""
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, Numeric, SmallInteger, String, Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

MONEDAS = ("USD", "CRC")


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Timestamped:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


# ---------- Catálogos ----------
# "clave" es el nombre normalizado (sin tildes, minúsculas) para impedir duplicados como "Cóbano"/"cobano".

class Sede(Base):
    __tablename__ = "sedes"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    nombre: Mapped[str] = mapped_column(String(60))
    clave: Mapped[str] = mapped_column(String(60), unique=True)


class Tratamiento(Base):
    __tablename__ = "tratamientos"
    __table_args__ = (
        CheckConstraint("precio >= 0", name="ck_tratamientos_precio"),
        CheckConstraint("moneda IN ('USD', 'CRC')", name="ck_tratamientos_moneda"),
        CheckConstraint("viajes IN (1, 2)", name="ck_tratamientos_viajes"),
        CheckConstraint("arcos IS NULL OR arcos IN (1, 2)", name="ck_tratamientos_arcos"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nombre: Mapped[str] = mapped_column(String(80))
    clave: Mapped[str] = mapped_column(String(80), unique=True)
    precio: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    moneda: Mapped[str] = mapped_column(String(3))
    viajes: Mapped[int] = mapped_column(SmallInteger, default=2)
    arcos: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)


class Hotel(Base):
    __tablename__ = "hoteles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nombre: Mapped[str] = mapped_column(String(80))
    clave: Mapped[str] = mapped_column(String(80), unique=True)


class Vuelo(Base):
    __tablename__ = "vuelos"
    __table_args__ = (
        UniqueConstraint("clave_origen", "clave_destino", name="uq_vuelos_ruta"),
        CheckConstraint("tipo IN ('internacional', 'nacional')", name="ck_vuelos_tipo"),
        CheckConstraint("precio IS NULL OR precio >= 0", name="ck_vuelos_precio"),
        CheckConstraint("moneda IN ('USD', 'CRC')", name="ck_vuelos_moneda"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tipo: Mapped[str] = mapped_column(String(15))
    origen: Mapped[str] = mapped_column(String(20))
    destino: Mapped[str] = mapped_column(String(20))
    clave_origen: Mapped[str] = mapped_column(String(20))
    clave_destino: Mapped[str] = mapped_column(String(20))
    precio: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    moneda: Mapped[str] = mapped_column(String(3), default="USD")


# ---------- Pacientes ----------

class Paciente(Timestamped, Base):
    __tablename__ = "pacientes"
    __table_args__ = (
        CheckConstraint("pagos_viajes IN (1, 2)", name="ck_pacientes_viajes"),
        CheckConstraint("arcos IS NULL OR arcos IN (1, 2)", name="ck_pacientes_arcos"),
        CheckConstraint("pagos_total >= 0 AND viaje1_monto >= 0 AND viaje2_monto >= 0", name="ck_pacientes_montos"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    nombre: Mapped[str] = mapped_column(String(120))
    pais: Mapped[str] = mapped_column(String(60), default="")
    email: Mapped[str] = mapped_column(String(120), default="")
    telefono: Mapped[str] = mapped_column(String(30), default="")
    sede_id: Mapped[str] = mapped_column(ForeignKey("sedes.id", ondelete="RESTRICT"), index=True)
    tratamiento: Mapped[str] = mapped_column(String(80), default="")
    arcos: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    etapa_manual: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Itinerario (fechas locales de Costa Rica, sin zona horaria)
    llegada_ruta: Mapped[str] = mapped_column(String(30), default="")
    llegada_vuelo: Mapped[str] = mapped_column(String(10), default="", server_default="")
    llegada_fecha: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    vuelo_nacional: Mapped[bool] = mapped_column(Boolean, default=True)
    nacional_ida_ruta: Mapped[str] = mapped_column(String(30), default="")
    nacional_ida_vuelo: Mapped[str] = mapped_column(String(10), default="", server_default="")
    nacional_ida_fecha: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    pickup_fecha: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    hotel_nombre: Mapped[str] = mapped_column(String(80), default="")
    hotel_checkin: Mapped[date | None] = mapped_column(Date, nullable=True)
    hotel_checkout: Mapped[date | None] = mapped_column(Date, nullable=True)
    nacional_regreso_ruta: Mapped[str] = mapped_column(String(30), default="")
    nacional_regreso_vuelo: Mapped[str] = mapped_column(String(10), default="", server_default="")
    nacional_regreso_fecha: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    salida_ruta: Mapped[str] = mapped_column(String(30), default="")
    salida_vuelo: Mapped[str] = mapped_column(String(10), default="", server_default="")
    salida_fecha: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Pagos (USD)
    pagos_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    pagos_viajes: Mapped[int] = mapped_column(SmallInteger, default=2)
    viaje1_monto: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    viaje1_estado: Mapped[str] = mapped_column(String(10), default="pendiente")
    viaje2_monto: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    viaje2_estado: Mapped[str] = mapped_column(String(10), default="pendiente")

    # Seguro de viaje
    seguro_aseguradora: Mapped[str] = mapped_column(String(60), default="")
    seguro_poliza: Mapped[str] = mapped_column(String(40), default="")
    seguro_estado: Mapped[str] = mapped_column(String(10), default="pendiente")

    created_by: Mapped[str] = mapped_column(String(120), default="")
    updated_by: Mapped[str] = mapped_column(String(120), default="")

    documentos: Mapped[list["Documento"]] = relationship(
        back_populates="paciente", cascade="all, delete-orphan", order_by="Documento.fecha",
    )
    comentarios: Mapped[list["Comentario"]] = relationship(
        back_populates="paciente", cascade="all, delete-orphan", order_by="Comentario.fecha",
    )


class EstadoVuelo(Base):
    """Última respuesta de AirLabs por número de vuelo (caché para cuidar la cuota mensual)."""
    __tablename__ = "estados_vuelo"
    vuelo: Mapped[str] = mapped_column(String(10), primary_key=True)
    encontrado: Mapped[bool] = mapped_column(Boolean, default=False)
    datos: Mapped[str] = mapped_column(Text, default="")  # JSON con los campos normalizados
    consultado_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Documento(Base):
    __tablename__ = "documentos"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    paciente_id: Mapped[str] = mapped_column(ForeignKey("pacientes.id", ondelete="CASCADE"), index=True)
    nombre: Mapped[str] = mapped_column(String(255))
    tipo: Mapped[str] = mapped_column(String(20))
    fecha: Mapped[date] = mapped_column(Date)
    content_type: Mapped[str] = mapped_column(String(50))
    tamano: Mapped[int] = mapped_column(Integer)
    # Nombre aleatorio del archivo en el volumen privado (nunca el nombre original).
    storage_key: Mapped[str] = mapped_column(String(64), unique=True)
    created_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    paciente: Mapped[Paciente] = relationship(back_populates="documentos")


class Comentario(Base):
    __tablename__ = "comentarios"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    paciente_id: Mapped[str] = mapped_column(ForeignKey("pacientes.id", ondelete="CASCADE"), index=True)
    autor: Mapped[str] = mapped_column(String(120))
    autor_sub: Mapped[str] = mapped_column(String(120), default="")
    texto: Mapped[str] = mapped_column(Text)
    fecha: Mapped[datetime] = mapped_column(DateTime)

    paciente: Mapped[Paciente] = relationship(back_populates="comentarios")
