from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app import flights
from app.config import get_settings

from .test_pacientes import PACIENTE


def _local(delta: timedelta) -> str:
    now = datetime.now(ZoneInfo("America/Costa_Rica")).replace(tzinfo=None)
    return (now + delta).strftime("%Y-%m-%dT%H:%M")


@pytest.fixture
def airlabs(monkeypatch):
    """AirLabs simulado: registra las consultas y devuelve datos según el número de vuelo."""
    calls = []
    respuestas = {
        "AA1234": {"status": "scheduled", "dep_delayed": 45, "dep_estimated": "2026-10-03 16:25", "dep_gate": "D12"},
    }

    def fake(vuelo, settings):
        calls.append(vuelo)
        if vuelo == "XX999":
            raise flights.AirLabsError("AirLabs respondió con error 500.")
        return respuestas.get(vuelo)

    monkeypatch.setattr(flights, "fetch_airlabs", fake)
    monkeypatch.setattr(get_settings(), "airlabs_api_key", "clave-de-prueba")
    return calls


def _crear(client, **tramos):
    res = client.post("/api/pacientes", json={**PACIENTE, **tramos})
    assert res.status_code == 201, res.text
    return res.json()


def _actualizar(client, paciente, tramo):
    return client.post("/api/estado-vuelos/actualizar", json={"pacienteId": paciente["id"], "tramo": tramo})


def test_numero_de_vuelo_se_normaliza_y_valida(auth_client):
    p = _crear(auth_client, llegada={"ruta": "MIA → SJO", "fecha": "2026-10-12T15:40", "vuelo": "aa 1234"})
    assert p["llegada"]["vuelo"] == "AA1234"
    malo = {**PACIENTE, "salida": {"ruta": "", "fecha": "", "vuelo": "1234"}}
    assert auth_client.post("/api/pacientes", json=malo).status_code == 422


def test_listar_estados_nunca_consulta_airlabs(auth_client, airlabs):
    _crear(
        auth_client,
        llegada={"ruta": "MIA → SJO", "fecha": _local(timedelta(hours=1)), "vuelo": "AA1234"},
        salida={"ruta": "SJO → MIA", "fecha": _local(timedelta(days=5)), "vuelo": "AA1235"},
        nacionalIda={"ruta": "SJO → Cóbano", "fecha": _local(timedelta(days=-3)), "vuelo": "CM404", "aplica": True},
    )
    estados = {e["tramo"]: e["fase"] for e in auth_client.get("/api/estado-vuelos").json()}
    assert estados == {"llegada": "pendiente", "salida": "programado", "nacionalIda": "finalizado"}
    assert airlabs == []


def test_actualizar_manual_consulta_y_guarda(auth_client, airlabs):
    p = _crear(auth_client, llegada={"ruta": "MIA → SJO", "fecha": _local(timedelta(hours=1)), "vuelo": "AA1234"})
    res = _actualizar(auth_client, p, "llegada").json()
    assert res["fase"] == "en-ventana"
    assert res["datos"]["depDelayed"] == 45 and res["datos"]["depGate"] == "D12"
    assert airlabs == ["AA1234"]

    # Queda guardado: la lista lo muestra sin volver a consultar.
    estado = auth_client.get("/api/estado-vuelos").json()[0]
    assert estado["fase"] == "en-ventana" and estado["datos"]["depDelayed"] == 45
    # Un segundo clic inmediato no gasta otra consulta.
    _actualizar(auth_client, p, "llegada")
    assert airlabs == ["AA1234"]


def test_actualizar_fuera_de_la_ventana_no_consulta(auth_client, airlabs):
    p = _crear(auth_client, salida={"ruta": "SJO → MIA", "fecha": _local(timedelta(days=5)), "vuelo": "AA1235"})
    assert _actualizar(auth_client, p, "salida").json()["fase"] == "programado"
    assert airlabs == []


def test_vuelo_no_encontrado_y_error(auth_client, airlabs):
    p = _crear(
        auth_client,
        llegada={"ruta": "", "fecha": _local(timedelta(minutes=30)), "vuelo": "ZZ1"},
        salida={"ruta": "", "fecha": _local(timedelta(minutes=-30)), "vuelo": "XX999"},
    )
    assert _actualizar(auth_client, p, "llegada").json()["fase"] == "no-encontrado"
    error = _actualizar(auth_client, p, "salida").json()
    assert error["fase"] == "error" and "500" in error["mensaje"]


def test_sin_clave_no_consulta(auth_client, monkeypatch):
    monkeypatch.setattr(get_settings(), "airlabs_api_key", "")
    llamadas = []
    monkeypatch.setattr(flights, "fetch_airlabs", lambda v, s: llamadas.append(v))
    p = _crear(auth_client, llegada={"ruta": "", "fecha": _local(timedelta(hours=1)), "vuelo": "AA1234"})
    assert _actualizar(auth_client, p, "llegada").json()["fase"] == "sin-configurar"
    assert llamadas == []


def test_tramo_sin_numero(auth_client, airlabs):
    p = _crear(auth_client)
    assert _actualizar(auth_client, p, "llegada").status_code == 422


def test_estado_requiere_sesion(client):
    assert client.get("/api/estado-vuelos").status_code == 401
    assert client.post("/api/estado-vuelos/actualizar", json={"pacienteId": "x", "tramo": "llegada"}).status_code == 401
