"""Conversión entre el modelo plano de base de datos y el JSON anidado que usa el frontend."""
import unicodedata
from datetime import date, datetime
from decimal import Decimal

from . import models, schemas

DATETIME_FMT = "%Y-%m-%dT%H:%M"


def clave(texto: str) -> str:
    """Nombre normalizado para detectar duplicados: sin tildes, minúsculas y espacios simples."""
    sin_tildes = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return " ".join(sin_tildes.lower().split())


def _dt_in(value: str) -> datetime | None:
    return datetime.strptime(value, DATETIME_FMT) if value else None


def _d_in(value: str) -> date | None:
    return date.fromisoformat(value) if value else None


def _dt_out(value: datetime | None) -> str:
    return value.strftime(DATETIME_FMT) if value else ""


def _d_out(value: date | None) -> str:
    return value.isoformat() if value else ""


def _money(value: Decimal | None) -> float:
    return float(value or 0)


def apply_paciente(p: models.Paciente, data: schemas.PacienteIn) -> None:
    p.nombre = data.nombre
    p.pais = data.pais
    p.email = data.email
    p.telefono = data.telefono
    p.sede_id = data.sede
    p.tratamiento = data.tratamiento
    p.arcos = data.arcos

    p.llegada_ruta = data.llegada.ruta
    p.llegada_vuelo = data.llegada.vuelo
    p.llegada_fecha = _dt_in(data.llegada.fecha)
    p.vuelo_nacional = data.nacional_ida.aplica
    p.nacional_ida_ruta = data.nacional_ida.ruta if p.vuelo_nacional else ""
    p.nacional_ida_vuelo = data.nacional_ida.vuelo if p.vuelo_nacional else ""
    p.nacional_ida_fecha = _dt_in(data.nacional_ida.fecha) if p.vuelo_nacional else None
    p.pickup_fecha = _dt_in(data.pickup.fecha)
    p.hotel_nombre = data.hotel.nombre
    p.hotel_checkin = _d_in(data.hotel.checkin)
    p.hotel_checkout = _d_in(data.hotel.checkout)
    p.nacional_regreso_ruta = data.nacional_regreso.ruta if p.vuelo_nacional else ""
    p.nacional_regreso_vuelo = data.nacional_regreso.vuelo if p.vuelo_nacional else ""
    p.nacional_regreso_fecha = _dt_in(data.nacional_regreso.fecha) if p.vuelo_nacional else None
    p.salida_ruta = data.salida.ruta
    p.salida_vuelo = data.salida.vuelo
    p.salida_fecha = _dt_in(data.salida.fecha)

    pagos = data.pagos
    p.pagos_total = Decimal(str(pagos.total))
    p.pagos_viajes = pagos.viajes
    p.viaje1_monto = Decimal(str(pagos.viaje1.monto))
    p.viaje1_estado = pagos.viaje1.estado
    # Con pago único no queda saldo en un segundo viaje.
    p.viaje2_monto = Decimal(str(pagos.viaje2.monto)) if pagos.viajes == 2 else Decimal(0)
    p.viaje2_estado = pagos.viaje2.estado if pagos.viajes == 2 else "pendiente"

    p.seguro_aseguradora = data.seguro.aseguradora
    p.seguro_poliza = data.seguro.poliza
    p.seguro_estado = data.seguro.estado


def paciente_out(p: models.Paciente) -> schemas.PacienteOut:
    return schemas.PacienteOut(
        id=p.id,
        nombre=p.nombre,
        pais=p.pais,
        email=p.email,
        telefono=p.telefono,
        sede=p.sede_id,
        tratamiento=p.tratamiento,
        arcos=p.arcos,
        etapa_manual=p.etapa_manual,
        llegada=schemas.Tramo(ruta=p.llegada_ruta, fecha=_dt_out(p.llegada_fecha), vuelo=p.llegada_vuelo),
        nacional_ida=schemas.TramoNacional(
            ruta=p.nacional_ida_ruta, fecha=_dt_out(p.nacional_ida_fecha), vuelo=p.nacional_ida_vuelo, aplica=p.vuelo_nacional,
        ),
        pickup=schemas.Tramo(ruta="Aeropuerto → hotel", fecha=_dt_out(p.pickup_fecha)),
        hotel=schemas.Hospedaje(nombre=p.hotel_nombre, checkin=_d_out(p.hotel_checkin), checkout=_d_out(p.hotel_checkout)),
        nacional_regreso=schemas.TramoNacional(
            ruta=p.nacional_regreso_ruta, fecha=_dt_out(p.nacional_regreso_fecha), vuelo=p.nacional_regreso_vuelo,
            aplica=p.vuelo_nacional,
        ),
        salida=schemas.Tramo(ruta=p.salida_ruta, fecha=_dt_out(p.salida_fecha), vuelo=p.salida_vuelo),
        pagos=schemas.Pagos(
            total=_money(p.pagos_total),
            viajes=p.pagos_viajes,
            viaje1=schemas.Pago(monto=_money(p.viaje1_monto), estado=p.viaje1_estado),
            viaje2=schemas.Pago(monto=_money(p.viaje2_monto), estado=p.viaje2_estado),
        ),
        seguro=schemas.Seguro(aseguradora=p.seguro_aseguradora, poliza=p.seguro_poliza, estado=p.seguro_estado),
        documentos=[documento_out(d) for d in p.documentos],
        comentarios=[comentario_out(c) for c in p.comentarios],
    )


def documento_out(d: models.Documento) -> schemas.DocumentoOut:
    return schemas.DocumentoOut(id=d.id, nombre=d.nombre, tipo=d.tipo, fecha=_d_out(d.fecha), tamano=d.tamano)


def comentario_out(c: models.Comentario) -> schemas.ComentarioOut:
    return schemas.ComentarioOut(id=c.id, autor=c.autor, fecha=_dt_out(c.fecha), texto=c.texto)


def tratamiento_out(t: models.Tratamiento) -> schemas.TratamientoOut:
    return schemas.TratamientoOut(
        id=t.id, nombre=t.nombre, precio=_money(t.precio), moneda=t.moneda, viajes=t.viajes, arcos=t.arcos,
    )


def vuelo_out(v: models.Vuelo) -> schemas.VueloOut:
    return schemas.VueloOut(
        id=v.id, tipo=v.tipo, origen=v.origen, destino=v.destino,
        precio=None if v.precio is None else _money(v.precio), moneda=v.moneda,
    )
