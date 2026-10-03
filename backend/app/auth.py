"""Autenticación con Auth0: valida el access token (JWT RS256) contra las llaves públicas del tenant."""
from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import Settings, get_settings

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class User:
    sub: str
    nombre: str


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


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    settings: Settings = Depends(get_settings),
) -> User:
    if settings.auth_dev_bypass:
        return User(sub="dev|local", nombre="Desarrollo local")
    if not settings.auth0_configured:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "La autenticación no está configurada en el servidor.")
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized("Iniciá sesión para continuar.")

    claims = decode_token(credentials.credentials, settings)
    nombre = claims.get(settings.auth0_name_claim) or claims.get("email") or claims["sub"]
    return User(sub=claims["sub"], nombre=str(nombre)[:120])
