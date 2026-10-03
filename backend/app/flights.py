"""Estado de vuelos con AirLabs (https://airlabs.co/docs/flight).

La consulta es manual: el equipo pulsa «Actualizar» en un tramo y solo entonces se llama a AirLabs.
AirLabs devuelve el vuelo *actual* de un número (el de hoy), por eso solo se permite actualizar cerca
de la hora del tramo. La última respuesta se guarda en estados_vuelo y se muestra sin volver a consultar.
"""
import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from . import models
from .config import Settings

# Ventana, relativa a la hora del tramo, en la que se puede consultar AirLabs.
VENTANA_ANTES = timedelta(hours=8)
VENTANA_DESPUES = timedelta(hours=6)
# Evita gastar consultas por clics repetidos sobre el mismo vuelo.
INTERVALO_MINIMO = timedelta(minutes=1)

CAMPOS = (
    "status", "dep_iata", "arr_iata", "dep_time", "arr_time", "dep_estimated", "arr_estimated",
    "dep_actual", "arr_actual", "dep_delayed", "arr_delayed", "dep_gate", "arr_gate",
    "dep_terminal", "arr_terminal", "arr_baggage",
)


class AirLabsError(Exception):
    pass


def fetch_airlabs(vuelo: str, settings: Settings) -> dict | None:
    """Consulta un número de vuelo. Devuelve los campos normalizados o None si AirLabs no lo conoce."""
    codigo_icao = len(vuelo) > 3 and vuelo[:3].isalpha()
    params = {"api_key": settings.airlabs_api_key, ("flight_icao" if codigo_icao else "flight_iata"): vuelo}
    url = f"{settings.airlabs_url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "planificador-esthetic-dent"})
    try:
        with urllib.request.urlopen(request, timeout=8) as res:  # noqa: S310 — URL fija de AirLabs (https)
            body = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise AirLabsError(f"AirLabs respondió con error {exc.code}.") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise AirLabsError("No se pudo consultar AirLabs.") from exc

    if isinstance(body, dict) and body.get("error"):
        error = body["error"]
        mensaje = (error.get("message") if isinstance(error, dict) else str(error)) or "Error de AirLabs."
        if "not found" in mensaje.lower() or (isinstance(error, dict) and error.get("code") in ("not_found", "unknown_flight")):
            return None
        raise AirLabsError(f"AirLabs: {mensaje}")

    data = body.get("response", body) if isinstance(body, dict) else None
    if isinstance(data, list):
        data = data[0] if data else None
    if not isinstance(data, dict) or not data:
        return None
    return {campo: _normalizar(campo, data.get(campo)) for campo in CAMPOS}


def _normalizar(campo: str, valor):
    if valor is None or valor == "":
        return None
    if campo in ("dep_delayed", "arr_delayed"):
        try:
            return int(float(valor))
        except (TypeError, ValueError):
            return None
    return str(valor)[:40]


def actualizar(db: Session, vuelo: str, settings: Settings) -> tuple[models.EstadoVuelo | None, str]:
    """Consulta AirLabs (salvo que se haya consultado hace menos de un minuto). Devuelve (caché, error)."""
    cache = db.get(models.EstadoVuelo, vuelo)
    ahora = datetime.now(timezone.utc)
    if cache:
        consultado = cache.consultado_at if cache.consultado_at.tzinfo else cache.consultado_at.replace(tzinfo=timezone.utc)
        if ahora - consultado < INTERVALO_MINIMO:
            return cache, ""
    try:
        datos = fetch_airlabs(vuelo, settings)
    except AirLabsError as exc:
        return cache, str(exc)  # se conserva el último dato conocido, si hay
    if cache is None:
        cache = models.EstadoVuelo(vuelo=vuelo)
        db.add(cache)
    cache.encontrado = datos is not None
    cache.datos = json.dumps(datos or {})
    cache.consultado_at = ahora
    db.commit()
    return cache, ""
