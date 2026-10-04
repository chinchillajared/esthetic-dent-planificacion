"""Entorno de pruebas: SQLite en memoria y un "Auth0" simulado con una llave RSA generada en memoria."""
import os
import shutil
import tempfile
import time
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="planificador-tests-"))
os.environ.update({
    "ENVIRONMENT": "development",
    "DATABASE_URL": "sqlite://",
    "AUTH0_DOMAIN": "tenant-de-prueba.us.auth0.com",
    "AUTH0_AUDIENCE": "https://api.planificador.test",
    "AUTH0_CLIENT_ID": "client-de-prueba",
    "AUTH0_CONNECTION": "email",
    "AUTH0_CLIENT_SECRET": "secreto-de-prueba",
    "AUTH_DEV_BYPASS": "false",
    "UPLOAD_DIR": str(_tmp / "uploads"),
    "MAX_UPLOAD_MB": "1",
})

import jwt  # noqa: E402
import pytest  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed_catalogos  # noqa: E402

PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class _FakeJWKS:
    def get_signing_key_from_jwt(self, token):
        class _Key:
            key = PRIVATE_KEY.public_key()
        return _Key()


@pytest.fixture(autouse=True)
def _fake_auth0(monkeypatch):
    monkeypatch.setattr(auth, "jwks_client", lambda domain: _FakeJWKS())


@pytest.fixture(autouse=True)
def _fresh_db():
    shutil.rmtree(_tmp / "uploads", ignore_errors=True)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed_catalogos(db)
    yield


def make_token(*, key=None, audience=None, issuer=None, exp_delta=3600, **claims) -> str:
    now = int(time.time())
    payload = {
        "sub": "auth0|coordinadora",
        "iss": issuer or f"https://{os.environ['AUTH0_DOMAIN']}/",
        "aud": audience or os.environ["AUTH0_AUDIENCE"],
        "iat": now,
        "exp": now + exp_delta,
        "https://esthetic-dent.app/name": "Ana Coordinadora",
        **claims,
    }
    return jwt.encode(payload, key or PRIVATE_KEY, algorithm="RS256", headers={"kid": "test"})


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def auth_client(client) -> TestClient:
    client.headers.update({"Authorization": f"Bearer {make_token()}"})
    return client
