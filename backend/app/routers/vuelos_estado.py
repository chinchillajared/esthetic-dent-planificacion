"""Estado de los vuelos de los pacientes (AirLabs).

GET  /api/estado-vuelos            → último estado guardado de cada tramo; nunca consulta AirLabs.
POST /api/estado-vuelos/actualizar → consulta AirLabs para un tramo (acción manual del equipo).
"""
import json
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import flights, models, schemas
from ..auth import get_current_user
from ..config import Settings, get_settings
from ..db import get_db

router = APIRouter(prefix="/api", tags=["vuelos"], dependencies=[Depends(get_current_user)])

# clave del tramo en el frontend → (columna del número, columna de la fecha, ¿es nacional?)
TRAMOS = {
    "llegada": ("llegada_vuelo", "llegada_fecha", False),
    "nacionalIda": ("nacional_ida_vuelo", "nacional_ida_fecha", True),
    "nacionalRegreso": ("nacional_regreso_vuelo", "nacional_regreso_fecha", True),
    "salida": ("salida_vuelo", "salida_fecha", False),
}


def _ahora(settings: Settings) -> datetime:
    return datetime.now(ZoneInfo(settings.timezone)).replace(tzinfo=None)


def _salida(base: dict, cache: models.EstadoVuelo | None, fase_sin_datos: str, mensaje: str = "") -> schemas.EstadoVueloOut:
    if cache is None:
        return schemas.EstadoVueloOut(**base, fase=fase_sin_datos, mensaje=mensaje)
    consultado = cache.consultado_at.isoformat()
    if not cache.encontrado:
        return schemas.EstadoVueloOut(**base, fase="no-encontrado", mensaje=mensaje, consultado=consultado)
    return schemas.EstadoVueloOut(
        **base, fase="en-ventana", datos=schemas.EstadoVueloDatos(**json.loads(cache.datos or "{}")),
        mensaje=mensaje, consultado=consultado,
    )


def _estado_tramo(
    p: models.Paciente, tramo: str, ahora: datetime, db: Session, settings: Settings, refrescar: bool,
) -> schemas.EstadoVueloOut | None:
    col_vuelo, col_fecha, nacional = TRAMOS[tramo]
    vuelo = getattr(p, col_vuelo)
    if not vuelo or (nacional and not p.vuelo_nacional):
        return None
    fecha: datetime | None = getattr(p, col_fecha)
    base = {"paciente_id": p.id, "tramo": tramo, "vuelo": vuelo}

    if fecha is None:
        return schemas.EstadoVueloOut(**base, fase="sin-fecha")
    if ahora < fecha - flights.VENTANA_ANTES:
        return schemas.EstadoVueloOut(**base, fase="programado")
    if ahora > fecha + flights.VENTANA_DESPUES:
        return schemas.EstadoVueloOut(**base, fase="finalizado")
    if not settings.airlabs_api_key:
        return schemas.EstadoVueloOut(**base, fase="sin-configurar")

    if refrescar:
        cache, error = flights.actualizar(db, vuelo, settings)
        return _salida(base, cache, "error", error)
    # Sin consultar: dentro de la ventana pero todavía nadie pulsó «Actualizar».
    return _salida(base, db.get(models.EstadoVuelo, vuelo), "pendiente")


@router.get("/estado-vuelos", response_model=list[schemas.EstadoVueloOut])
def estado_vuelos(db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    ahora = _ahora(settings)
    resultados = []
    for p in db.scalars(select(models.Paciente)):
        for tramo in TRAMOS:
            estado = _estado_tramo(p, tramo, ahora, db, settings, refrescar=False)
            if estado:
                resultados.append(estado)
    return resultados


@router.post("/estado-vuelos/actualizar", response_model=schemas.EstadoVueloOut)
def actualizar_estado(
    data: schemas.ActualizarEstadoIn, db: Session = Depends(get_db), settings: Settings = Depends(get_settings),
):
    paciente = db.get(models.Paciente, data.paciente_id)
    if not paciente:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "El paciente no existe.")
    if data.tramo not in TRAMOS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Ese tramo no es un vuelo.")
    estado = _estado_tramo(paciente, data.tramo, _ahora(settings), db, settings, refrescar=True)
    if estado is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Este tramo no tiene número de vuelo.")
    return estado
