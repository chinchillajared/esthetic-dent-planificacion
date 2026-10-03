import pytest
from pydantic import ValidationError

from app.config import Settings

from .conftest import OTHER_KEY, make_token


def test_health_y_config_son_publicos(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    cfg = client.get("/api/config/auth").json()
    assert cfg == {
        "modo": "auth0",
        "domain": "tenant-de-prueba.us.auth0.com",
        "clientId": "client-de-prueba",
        "audience": "https://api.planificador.test",
    }


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
    assert auth_client.get("/api/me").json() == {"sub": "auth0|coordinadora", "nombre": "Ana Coordinadora"}


def test_bypass_de_desarrollo_prohibido_en_produccion():
    with pytest.raises(ValidationError):
        Settings(environment="production", auth_dev_bypass=True)
