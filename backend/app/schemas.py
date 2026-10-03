"""Esquemas de entrada/salida. Los nombres JSON coinciden con los que usa el frontend (camelCase)."""
import re
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel

Moneda = Literal["USD", "CRC"]
EstadoPago = Literal["pendiente", "pagado"]
Etapa = Literal["llegada", "nacionalIda", "pickup", "hotel", "nacionalRegreso", "salida"]
TipoDocumento = Literal["pasaporte", "seguro", "radiografia", "comprobante", "otro"]

Texto = lambda n: Annotated[str, StringConstraints(strip_whitespace=True, max_length=n)]  # noqa: E731
Nombre = lambda n: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=n)]  # noqa: E731

# Fechas tal como las maneja el frontend: "YYYY-MM-DDTHH:MM" / "YYYY-MM-DD" o vacío.
FechaHora = Annotated[str, StringConstraints(pattern=r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})?$")]
Fecha = Annotated[str, StringConstraints(pattern=r"^(\d{4}-\d{2}-\d{2})?$")]

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _email(value: str) -> str:
    if value and not _EMAIL.match(value):
        raise ValueError("El correo no tiene un formato válido.")
    return value


Email = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120), AfterValidator(_email)]

# Aerolínea: IATA de 2 caracteres con al menos una letra (AA, B6, 2K) o ICAO de 3 letras (AAL).
_VUELO = re.compile(r"^([A-Z][A-Z0-9]|[0-9][A-Z]|[A-Z]{3})\d{1,4}[A-Z]?$")


def _vuelo(value: str) -> str:
    # "aa 1234" → "AA1234": código de aerolínea (IATA de 2 o ICAO de 3) + número.
    value = "".join(value.split()).upper()
    if value and not _VUELO.match(value):
        raise ValueError("El número de vuelo debe tener el código de la aerolínea y el número, p. ej. AA1234.")
    return value


NumeroVuelo = Annotated[str, StringConstraints(max_length=12), AfterValidator(_vuelo)]
Monto = Annotated[float, Field(ge=0, le=1_000_000_000)]


class Schema(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


# ---------- Catálogos ----------

class SedeIn(Schema):
    nombre: Nombre(60)


class SedeOut(Schema):
    id: str
    nombre: str


class TratamientoIn(Schema):
    nombre: Nombre(80)
    precio: Monto
    moneda: Moneda = "USD"
    viajes: Literal[1, 2] = 2
    arcos: Literal[1, 2] | None = None


class TratamientoOut(TratamientoIn):
    id: int


class HotelIn(Schema):
    nombre: Nombre(80)


class HotelOut(Schema):
    id: int
    nombre: str


class VueloIn(Schema):
    tipo: Literal["internacional", "nacional"]
    origen: Nombre(20)
    destino: Nombre(20)
    precio: Monto | None = None
    moneda: Moneda = "USD"


class VueloOut(VueloIn):
    id: int


class Catalogos(Schema):
    sedes: list[SedeOut]
    tratamientos: list[TratamientoOut]
    hoteles: list[HotelOut]
    vuelos: list[VueloOut]


# ---------- Pacientes ----------

class Tramo(Schema):
    ruta: Texto(30) = ""
    fecha: FechaHora = ""
    vuelo: NumeroVuelo = ""


class TramoNacional(Tramo):
    aplica: bool = True


class Hospedaje(Schema):
    nombre: Texto(80) = ""
    checkin: Fecha = ""
    checkout: Fecha = ""


class Pago(Schema):
    monto: Monto = 0
    estado: EstadoPago = "pendiente"


class Pagos(Schema):
    total: Monto = 0
    viajes: Literal[1, 2] = 2
    viaje1: Pago = Pago()
    viaje2: Pago = Pago()


class Seguro(Schema):
    aseguradora: Texto(60) = ""
    poliza: Texto(40) = ""
    estado: Literal["pendiente", "vigente"] = "pendiente"


class PacienteIn(Schema):
    nombre: Nombre(120)
    pais: Texto(60) = ""
    email: Email = ""
    telefono: Texto(30) = ""
    sede: Nombre(64)
    tratamiento: Texto(80) = ""
    arcos: Literal[1, 2] | None = None
    llegada: Tramo = Tramo()
    nacional_ida: TramoNacional = TramoNacional()
    pickup: Tramo = Tramo()
    hotel: Hospedaje = Hospedaje()
    nacional_regreso: TramoNacional = TramoNacional()
    salida: Tramo = Tramo()
    pagos: Pagos = Pagos()
    seguro: Seguro = Seguro()


class DocumentoOut(Schema):
    id: str
    nombre: str
    tipo: TipoDocumento
    fecha: str
    tamano: int


class DocumentoUpdate(Schema):
    tipo: TipoDocumento


class ComentarioIn(Schema):
    texto: Nombre(1000)


class ComentarioOut(Schema):
    id: int
    autor: str
    fecha: str
    texto: str


class PacienteOut(PacienteIn):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    id: str
    etapa_manual: Etapa | None = None
    documentos: list[DocumentoOut] = []
    comentarios: list[ComentarioOut] = []


class EtapaIn(Schema):
    etapa: Etapa | None = None


class AuthConfig(Schema):
    modo: Literal["auth0", "desarrollo", "sin-configurar"]
    domain: str = ""
    client_id: str = ""
    audience: str = ""


class EstadoVueloDatos(Schema):
    status: str | None = None
    dep_iata: str | None = None
    arr_iata: str | None = None
    dep_time: str | None = None
    arr_time: str | None = None
    dep_estimated: str | None = None
    arr_estimated: str | None = None
    dep_actual: str | None = None
    arr_actual: str | None = None
    dep_delayed: int | None = None
    arr_delayed: int | None = None
    dep_gate: str | None = None
    arr_gate: str | None = None
    dep_terminal: str | None = None
    arr_terminal: str | None = None
    arr_baggage: str | None = None


class EstadoVueloOut(Schema):
    paciente_id: str
    tramo: Etapa
    vuelo: str
    # programado: falta mucho para el vuelo · finalizado: ya pasó · en-ventana: datos de AirLabs
    # pendiente: se puede consultar pero nadie lo actualizó · sin-fecha · sin-configurar (falta la clave)
    # no-encontrado · error
    fase: Literal[
        "programado", "finalizado", "en-ventana", "pendiente", "sin-fecha", "sin-configurar", "no-encontrado", "error",
    ]
    datos: EstadoVueloDatos | None = None
    mensaje: str = ""
    consultado: str = ""


class ActualizarEstadoIn(Schema):
    paciente_id: Nombre(36)
    tramo: Etapa


class Me(Schema):
    sub: str
    nombre: str
