"""Autenticación con Auth0: valida el access token (JWT RS256) contra las llaves públicas del tenant."""
import time
from dataclasses import dataclass
from functools import lru_cache

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import Settings, get_settings

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class User:
    sub: str
    nombre: str
    email: str = ""


@lru_cache
def jwks_client(domain: str) -> jwt.PyJWKClient:
    # Las llaves se guardan en caché; solo se vuelve a consultar Auth0 si aparece un "kid" nuevo.
    return jwt.PyJWKClient(f"https://{domain}/.well-known/jwks.json", cache_keys=True, lifespan=3600)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def decode_token(token: str, settings: Settings) -> dict:
    try:
        signing_key = jwks_client(settings.auth0_domain).get_signing_key_from_jwt(token).key
        return jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            audience=settings.auth0_audience,
            issuer=f"https://{settings.auth0_domain}/",
            options={"require": ["exp", "iat", "sub", "iss", "aud"]},
            leeway=30,
        )
    except (jwt.InvalidTokenError, jwt.PyJWKClientError) as exc:
        raise _unauthorized("La sesión no es válida o expiró. Iniciá sesión de nuevo.") from exc


_PERFILES: dict[str, tuple[float, dict]] = {}
PERFIL_TTL = 600  # segundos


def fetch_userinfo(token: str, domain: str) -> dict:
    """Nombre y correo desde /userinfo de Auth0 (si la Action no los agrega al token)."""
    try:
        res = httpx.get(f"https://{domain}/userinfo", headers={"Authorization": f"Bearer {token}"}, timeout=5)
        return res.json() if res.status_code == 200 else {}
    except (httpx.HTTPError, ValueError):
        return {}


def _perfil(sub: str, token: str, settings: Settings) -> dict:
    ahora = time.monotonic()
    guardado = _PERFILES.get(sub)
    if guardado and guardado[0] > ahora:
        return guardado[1]
    perfil = fetch_userinfo(token, settings.auth0_domain)
    if len(_PERFILES) > 500:
        _PERFILES.clear()
    # Si Auth0 no respondió, se reintenta en un minuto en lugar de esperar el TTL completo.
    _PERFILES[sub] = (ahora + (PERFIL_TTL if perfil else 60), perfil)
    return perfil


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    settings: Settings = Depends(get_settings),
) -> User:
    if settings.auth_dev_bypass:
        return User(sub="dev|local", nombre="Desarrollo local", email="")
    if not settings.auth0_configured:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "La autenticación no está configurada en el servidor.")
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized("Iniciá sesión para continuar.")

    claims = decode_token(credentials.credentials, settings)
    sub = claims["sub"]
    email = claims.get(settings.auth0_email_claim) or claims.get("email")
    nombre = claims.get(settings.auth0_name_claim)
    if not (email and nombre):
        perfil = _perfil(sub, credentials.credentials, settings)
        email = email or perfil.get("email")
        nombre = nombre or perfil.get("name") or perfil.get("nickname")
    email = str(email or "")[:120]
    return User(sub=sub, nombre=str(nombre or email or "Usuario")[:120], email=email)
