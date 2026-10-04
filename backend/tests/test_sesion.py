"""Inicio de sesión por código: el backend habla con Auth0 (simulado con un httpx falso)."""
import httpx
import pytest

from app.routers import sesion


class _Res:
    def __init__(self, status_code: int, data: dict | None = None):
        self.status_code = status_code
        self._data = data or {}

    def json(self):
        return self._data


@pytest.fixture
def auth0(monkeypatch):
    """Registra las llamadas a Auth0 y responde según la ruta."""
    calls = []
    respuestas = {}

    def fake_post(url, json, timeout):
        path = url.split(".auth0.com", 1)[1]
        calls.append((path, json))
        handler = respuestas.get(path)
        return handler(json) if handler else _Res(200, {})

    monkeypatch.setattr(sesion.httpx, "post", fake_post)
    monkeypatch.setattr(sesion, "_code_hits", {})
    return calls, respuestas


def test_config_indica_inicio_con_auth0(client):
    assert client.get("/api/config/auth").json() == {"modo": "auth0"}


def test_enviar_codigo_usa_passwordless_con_client_secret(client, auth0):
    calls, _ = auth0
    res = client.post("/api/auth/code", json={"email": "Ana@Example.com"})
    assert res.status_code == 204
    path, body = calls[0]
    assert path == "/passwordless/start"
    assert body["connection"] == "email" and body["send"] == "code" and body["email"] == "ana@example.com"
    assert body["client_secret"] == "secreto-de-prueba"


def test_limite_de_codigos_por_correo(client, auth0):
    for _ in range(sesion.CODE_LIMIT):
        assert client.post("/api/auth/code", json={"email": "ana@example.com"}).status_code == 204
    assert client.post("/api/auth/code", json={"email": "ana@example.com"}).status_code == 429


def test_correo_invalido(client, auth0):
    assert client.post("/api/auth/code", json={"email": "no-es-correo"}).status_code == 422


def test_canjear_codigo_entrega_token_y_cookie_httponly(client, auth0):
    calls, respuestas = auth0
    respuestas["/oauth/token"] = lambda body: _Res(200, {"access_token": "AT", "refresh_token": "RT", "expires_in": 3600})
    res = client.post("/api/auth/token", json={"email": "ana@example.com", "code": "123456"})
    assert res.status_code == 200
    assert res.json() == {"accessToken": "AT", "expiresIn": 3600}
    cookie = res.headers["set-cookie"]
    assert "pp_refresh=RT" in cookie and "HttpOnly" in cookie and "Path=/api/auth" in cookie
    assert "samesite=strict" in cookie.lower()
    body = calls[0][1]
    assert body["grant_type"] == sesion.PASSWORDLESS_GRANT and body["realm"] == "email" and body["otp"] == "123456"
    assert body["audience"] == "https://api.planificador.test"


def test_codigo_incorrecto(client, auth0):
    _, respuestas = auth0
    respuestas["/oauth/token"] = lambda body: _Res(403, {"error": "invalid_grant"})
    res = client.post("/api/auth/token", json={"email": "ana@example.com", "code": "000000"})
    assert res.status_code == 401
    assert "código" in res.json()["detail"]


def test_correo_sin_alta(client, auth0):
    _, respuestas = auth0
    # Con «Disable Sign Ups», Auth0 rechaza los correos que no son usuarios.
    respuestas["/passwordless/start"] = lambda body: _Res(400, {"error": "x", "error_description": "Public signup is disabled"})
    res = client.post("/api/auth/code", json={"email": "extrano@example.com"})
    assert res.status_code == 403


def test_renovar_sin_cookie_y_con_cookie(client, auth0):
    _, respuestas = auth0
    assert client.post("/api/auth/refresh").status_code == 401

    respuestas["/oauth/token"] = lambda body: _Res(200, {"access_token": "AT2", "refresh_token": "RT2", "expires_in": 3600})
    client.cookies.set("pp_refresh", "RT", path="/api/auth")
    res = client.post("/api/auth/refresh")
    assert res.status_code == 200 and res.json()["accessToken"] == "AT2"
    assert "pp_refresh=RT2" in res.headers["set-cookie"]

    respuestas["/oauth/token"] = lambda body: _Res(403, {"error": "invalid_grant"})
    vencida = client.post("/api/auth/refresh")
    assert vencida.status_code == 401
    assert 'pp_refresh=""' in vencida.headers["set-cookie"] or "Max-Age=0" in vencida.headers["set-cookie"]


def test_cerrar_sesion_revoca_y_borra_cookie(client, auth0):
    calls, _ = auth0
    client.cookies.set("pp_refresh", "RT", path="/api/auth")
    res = client.post("/api/auth/logout")
    assert res.status_code == 204
    assert calls[0][0] == "/oauth/revoke" and calls[0][1]["token"] == "RT"
    assert "pp_refresh" in res.headers["set-cookie"]


def test_auth0_caido(client, monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("sin red")
    monkeypatch.setattr(sesion.httpx, "post", boom)
    monkeypatch.setattr(sesion, "_code_hits", {})
    assert client.post("/api/auth/code", json={"email": "ana@example.com"}).status_code == 503


def test_me_incluye_correo_del_token(client):
    from .conftest import make_token
    token = make_token(**{"https://esthetic-dent.app/email": "ana@example.com"})
    me = client.get("/api/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me["email"] == "ana@example.com" and me["nombre"] == "Ana Coordinadora"
