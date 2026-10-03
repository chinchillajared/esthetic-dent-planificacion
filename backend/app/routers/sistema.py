"""Salud del servicio, configuración pública de Auth0 para el frontend y usuario actual."""
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import User, get_current_user
from ..config import Settings, get_settings
from ..db import get_db

router = APIRouter(prefix="/api", tags=["sistema"])


@router.get("/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001 — cualquier fallo de la base marca el servicio como no disponible
        return JSONResponse({"status": "error", "database": "unavailable"}, status_code=503)
    return {"status": "ok"}


@router.get("/config/auth", response_model=schemas.AuthConfig)
def auth_config(settings: Settings = Depends(get_settings)):
    # Dominio, Client ID y audience son públicos: el frontend los necesita para iniciar sesión.
    if settings.auth_dev_bypass:
        return schemas.AuthConfig(modo="desarrollo")
    if not (settings.auth0_configured and settings.auth0_client_id):
        return schemas.AuthConfig(modo="sin-configurar")
    return schemas.AuthConfig(
        modo="auth0",
        domain=settings.auth0_domain,
        client_id=settings.auth0_client_id,
        audience=settings.auth0_audience,
    )


@router.get("/me", response_model=schemas.Me)
def me(user: User = Depends(get_current_user)):
    return schemas.Me(sub=user.sub, nombre=user.nombre)
