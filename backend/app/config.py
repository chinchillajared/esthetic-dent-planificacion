"""Configuración leída de variables de entorno (.env vía docker compose)."""
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    environment: Literal["development", "production"] = "production"
    database_url: str = "sqlite:///./local.db"

    # Auth0: dominio del tenant, identificador de la API (audience) y Client ID de la SPA.
    auth0_domain: str = ""
    auth0_audience: str = ""
    auth0_client_id: str = ""
    # Claim personalizado (Auth0 Action) con el nombre del usuario dentro del access token.
    auth0_name_claim: str = "https://esthetic-dent.app/name"

    # Solo para desarrollo local mientras Auth0 no está configurado. Prohibido en producción.
    auth_dev_bypass: bool = False

    # AirLabs (estado de vuelos). Es secreta: solo vive en el backend.
    airlabs_api_key: str = ""
    airlabs_url: str = "https://airlabs.co/api/v9/flight"

    upload_dir: Path = Path("/data/uploads")
    max_upload_mb: int = 10
    seed_demo: bool = False
    timezone: str = "America/Costa_Rica"

    @model_validator(mode="after")
    def _check_bypass(self) -> "Settings":
        if self.auth_dev_bypass and self.environment != "development":
            raise ValueError("AUTH_DEV_BYPASS solo se permite con ENVIRONMENT=development.")
        return self

    @property
    def auth0_configured(self) -> bool:
        return bool(self.auth0_domain and self.auth0_audience)

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
