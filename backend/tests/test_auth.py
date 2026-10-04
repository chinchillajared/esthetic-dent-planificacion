import pytest
from pydantic import ValidationError

from app.config import Settings

from .conftest import OTHER_KEY, make_token


def test_health_y_config_son_publicos(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/config/auth").json() == {"modo": "auth0"}


@pytest.mark.parametrize("path", ["/api/me", "/api/pacientes", "/api/catalogos"])
def test_sin_token_responde_401(client, path):
    res = client.get(path)
    assert res.status_code == 401
    assert res.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize(
    "token",
    [
        make_token(exp_delta=-120),                        # expirado
        make_token(audience="https://otra-api.example"),   # otra API
        make_token(issuer="https://otro-tenant.auth0.com/"),
        make_token(key=OTHER_KEY),                          # firma de otra llave
        "no-es-un-jwt",
    ],
)
def test_tokens_invalidos_son_rechazados(client, token):
    res = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_token_valido_identifica_al_usuario(auth_client):
    assert auth_client.get("/api/me").json() == {"sub": "auth0|coordinadora", "nombre": "Ana Coordinadora", "email": ""}


def test_bypass_de_desarrollo_prohibido_en_produccion():
    with pytest.raises(ValidationError):
        Settings(environment="production", auth_dev_bypass=True)


def test_sin_claims_usa_el_perfil_de_auth0(client, monkeypatch):
    from app import auth

    llamadas = []

    def fake_userinfo(token, domain):
        llamadas.append(domain)
        return {"name": "Jared Chinchilla", "email": "jared@example.com"}

    monkeypatch.setattr(auth, "fetch_userinfo", fake_userinfo)
    token = make_token(sub="email|6aac9c9b41d0f889abee4d86", **{"https://esthetic-dent.app/name": None})
    headers = {"Authorization": f"Bearer {token}"}
    me = client.get("/api/me", headers=headers).json()
    assert me == {"sub": "email|6aac9c9b41d0f889abee4d86", "nombre": "Jared Chinchilla", "email": "jared@example.com"}
    client.get("/api/me", headers=headers)
    assert len(llamadas) == 1  # el perfil queda en caché


def test_sin_claims_ni_perfil_nunca_muestra_el_sub(client):
    token = make_token(sub="email|abc", **{"https://esthetic-dent.app/name": None})
    me = client.get("/api/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me["nombre"] == "Usuario"
