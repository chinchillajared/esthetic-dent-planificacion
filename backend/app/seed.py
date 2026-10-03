"""Datos iniciales.

- Catálogos (sedes, tratamientos, hoteles, vuelos): solo si la tabla está vacía.
- Pacientes de demostración: solo con SEED_DEMO=true y si no hay pacientes (nunca en producción real).

Uso: python -m app.seed
"""
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import models
from .config import get_settings
from .db import SessionLocal
from .mappers import clave

SEDES = [("pavas", "Pavas"), ("cobano", "Cóbano"), ("santa-teresa", "Santa Teresa")]

TRATAMIENTOS = [
    ("All-on-4", 9500, "USD", 2, 1),
    ("All-on-6", 12500, "USD", 2, 2),
    ("Smile Makeover", 7550, "USD", 2, 1),
    ("Carillas de porcelana", 6400, "USD", 2, 2),
    ("Implante unitario", 1600, "USD", 2, None),
    ("Coronas de zirconio", 2750000, "CRC", 1, None),
]

HOTELES = ["Hotel Grano de Oro", "Hotel Cocal", "Hotel El Jardín", "Hotel Nautilus"]

VUELOS = [
    *[v for code in ("MIA", "YYZ", "LAX", "LHR", "MEX", "FRA", "CDG")
      for v in (("internacional", code, "SJO", None), ("internacional", "SJO", code, None))],
    ("nacional", "SJO", "Cóbano", 95),
    ("nacional", "Cóbano", "SJO", 95),
]


def _count(db: Session, model) -> int:
    return db.scalar(select(func.count()).select_from(model))


def seed_catalogos(db: Session) -> None:
    if not _count(db, models.Sede):
        db.add_all(models.Sede(id=i, nombre=n, clave=clave(n)) for i, n in SEDES)
    if not _count(db, models.Tratamiento):
        db.add_all(
            models.Tratamiento(nombre=n, clave=clave(n), precio=Decimal(p), moneda=m, viajes=v, arcos=a)
            for n, p, m, v, a in TRATAMIENTOS
        )
    if not _count(db, models.Hotel):
        db.add_all(models.Hotel(nombre=n, clave=clave(n)) for n in HOTELES)
    if not _count(db, models.Vuelo):
        db.add_all(
            models.Vuelo(
                tipo=t, origen=o, destino=d, clave_origen=clave(o), clave_destino=clave(d),
                precio=None if p is None else Decimal(p), moneda="USD",
            )
            for t, o, d, p in VUELOS
        )
    db.commit()


def seed_demo(db: Session) -> None:
    """Pacientes ficticios con fechas relativas a hoy, para ver la app con datos."""
    if _count(db, models.Paciente):
        return
    tz = ZoneInfo(get_settings().timezone)
    now = datetime.now(tz).replace(tzinfo=None, second=0, microsecond=0)
    today = now.date()

    def at(days: int, hour: int, minute: int = 0) -> datetime:
        return datetime.combine(today + timedelta(days=days), datetime.min.time()).replace(hour=hour, minute=minute)

    def mins(m: int) -> datetime:
        return now + timedelta(minutes=m)

    def d(days: int) -> date:
        return today + timedelta(days=days)

    def paciente(**kw) -> models.Paciente:
        kw.setdefault("created_by", "Datos de demostración")
        kw.setdefault("updated_by", "Datos de demostración")
        return models.Paciente(**kw)

    demo = [
        paciente(
            nombre="Alejandro María Duarte", pais="Estados Unidos", email="alejandro.duarte@example.com",
            telefono="+1 305 555 0142", sede_id="santa-teresa", tratamiento="All-on-4", arcos=1,
            llegada_ruta="MIA → SJO", llegada_fecha=at(-1, 14, 20),
            nacional_ida_ruta="SJO → Cóbano", nacional_ida_fecha=mins(-150), pickup_fecha=mins(-20),
            hotel_nombre="Hotel El Jardín", hotel_checkin=d(0), hotel_checkout=d(5),
            nacional_regreso_ruta="Cóbano → SJO", nacional_regreso_fecha=at(5, 14),
            salida_ruta="SJO → MIA", salida_fecha=at(6, 11),
            pagos_total=Decimal(10480), viaje1_monto=Decimal(6288), viaje1_estado="pagado", viaje2_monto=Decimal(4192),
            seguro_aseguradora="Allianz Travel", seguro_poliza="AZ-88231", seguro_estado="vigente",
            comentarios=[models.Comentario(autor="Coordinación", texto="Viaja con su esposa. Solicitó habitación con vista al jardín.", fecha=at(-12, 10, 12))],
        ),
        paciente(
            nombre="Josefa Lindqvist", pais="Canadá", email="josefa.l@example.com", telefono="+1 416 555 0198",
            sede_id="santa-teresa", tratamiento="Smile Makeover", arcos=1,
            llegada_ruta="YYZ → SJO", llegada_fecha=at(-3, 15, 40),
            nacional_ida_ruta="SJO → Cóbano", nacional_ida_fecha=at(-2, 8, 30), pickup_fecha=at(-2, 9, 45),
            hotel_nombre="Hotel El Jardín", hotel_checkin=d(-2), hotel_checkout=d(4),
            nacional_regreso_ruta="Cóbano → SJO", nacional_regreso_fecha=at(4, 13),
            salida_ruta="SJO → YYZ", salida_fecha=at(5, 13, 15),
            pagos_total=Decimal(7550), viaje1_monto=Decimal(4530), viaje1_estado="pagado", viaje2_monto=Decimal(3020),
        ),
        paciente(
            nombre="Esteban Morales", pais="Estados Unidos", email="esteban.morales@example.com", telefono="+1 213 555 0110",
            sede_id="cobano", tratamiento="All-on-6", arcos=2,
            llegada_ruta="LAX → SJO", llegada_fecha=at(2, 6, 10),
            nacional_ida_ruta="SJO → Cóbano", nacional_ida_fecha=at(3, 9, 30), pickup_fecha=at(3, 11),
            hotel_nombre="Hotel Cocal", hotel_checkin=d(3), hotel_checkout=d(10),
            nacional_regreso_ruta="Cóbano → SJO", nacional_regreso_fecha=at(10, 12),
            salida_ruta="SJO → LAX", salida_fecha=at(11, 14, 30),
            pagos_total=Decimal(19250), viaje1_monto=Decimal(11550), viaje1_estado="pagado", viaje2_monto=Decimal(7700),
            seguro_aseguradora="World Nomads", seguro_poliza="WN-55120", seguro_estado="vigente",
            comentarios=[models.Comentario(autor="Dra. Rojas", texto="Confirmar tomografía antes del primer día de cirugía.", fecha=at(-4, 16, 40))],
        ),
        paciente(
            nombre="María Fernanda Ruiz", pais="Estados Unidos", email="mf.ruiz@example.com", telefono="+1 786 555 0175",
            sede_id="pavas", tratamiento="Carillas de porcelana", arcos=2, vuelo_nacional=False,
            llegada_ruta="MIA → SJO", llegada_fecha=mins(-25), pickup_fecha=mins(50),
            hotel_nombre="Hotel Grano de Oro", hotel_checkin=d(0), hotel_checkout=d(7),
            salida_ruta="SJO → MIA", salida_fecha=at(8, 16, 20),
            pagos_total=Decimal(12750), viaje1_monto=Decimal(7650), viaje2_monto=Decimal(5100),
            seguro_aseguradora="Seven Corners", seguro_poliza="SC-10293", seguro_estado="vigente",
        ),
        paciente(
            nombre="Daniel Okafor", pais="Reino Unido", email="d.okafor@example.com", telefono="+44 20 7946 0331",
            sede_id="cobano", tratamiento="Implante unitario",
            llegada_ruta="LHR → SJO", llegada_fecha=at(33, 16, 5),
            nacional_ida_ruta="SJO → Cóbano", hotel_nombre="Hotel Cocal", hotel_checkin=d(34), hotel_checkout=d(39),
            nacional_regreso_ruta="Cóbano → SJO", salida_ruta="SJO → LHR", salida_fecha=at(40, 18, 45),
            pagos_total=Decimal(3200), viaje1_monto=Decimal(1920), viaje2_monto=Decimal(1280),
            comentarios=[models.Comentario(autor="Coordinación", texto="Esperando confirmación del vuelo nacional con la aerolínea.", fecha=at(-3, 9, 5))],
        ),
        paciente(
            nombre="Sofía Herrera", pais="México", email="sofia.herrera@example.com", telefono="+52 55 5555 0187",
            sede_id="pavas", tratamiento="Coronas de zirconio", vuelo_nacional=False,
            llegada_ruta="MEX → SJO", llegada_fecha=at(37, 11, 50), pickup_fecha=at(37, 12, 45),
            hotel_nombre="Hotel Grano de Oro", hotel_checkin=d(37), hotel_checkout=d(42),
            salida_ruta="SJO → MEX", salida_fecha=at(43, 7, 30),
            pagos_total=Decimal(5400), pagos_viajes=1, viaje1_monto=Decimal(5400),
            seguro_aseguradora="AXA Assistance", seguro_poliza="AXA-77310", seguro_estado="vigente",
        ),
    ]
    db.add_all(demo)
    db.commit()


def main() -> None:
    settings = get_settings()
    with SessionLocal() as db:
        seed_catalogos(db)
        if settings.seed_demo:
            seed_demo(db)
    print("Datos iniciales verificados.")  # noqa: T201


if __name__ == "__main__":
    main()
