"""Inicio de sesión con código de un solo uso por correo (Auth0 Passwordless).

El backend habla con Auth0 con la client secret de la Regular Web Application, así el navegador
nunca la ve y el usuario escribe el código en la pantalla de la app:

- POST /api/auth/code    {email}        → Auth0 envía el código (/passwordless/start).
- POST /api/auth/token   {email, code}  → canje del código (grant passwordless/otp).
- POST /api/auth/refresh                → renueva el access token con el refresh token de la cookie.
- POST /api/auth/logout                 → revoca el refresh token y borra la cookie.

El access token vive solo en memoria del frontend; el refresh token queda en una cookie HttpOnly
(el JavaScript no puede leerla) limitada a /api/auth.
"""
import threading
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from .. import schemas
from ..config import Settings, get_settings

router = APIRouter(prefix="/api/auth", tags=["sesión"])

PASSWORDLESS_GRANT = "http://auth0.com/oauth/grant-type/passwordless/otp"
SCOPE = "openid profile email offline_access"

COOKIE = "pp_refresh"
COOKIE_PATH = "/api/auth"
COOKIE_MAX_AGE = 30 * 24 * 3600

# Además del límite por IP de nginx: máximo de códigos por correo en una ventana de tiempo.
CODE_LIMIT = 5
CODE_WINDOW = 600
_code_hits: dict[str, list[float]] = {}
_code_lock = threading.Lock()

# Errores de Auth0 → (código HTTP, mensaje para el usuario)
ERRORES = {
    "invalid_grant": (401, "El código no es correcto o ya venció. Pedí uno nuevo."),
    "too_many_attempts": (429, "Demasiados intentos. Esperá unos minutos e intentá de nuevo."),
    "access_denied": (403, "Ese correo no tiene acceso al planificador."),
    "bad.email": (400, "Escribí un correo electrónico válido."),
    "bad.connection": (503, "El inicio de sesión por correo no está habilitado en Auth0."),
    "unauthorized_client": (503, 'Falta habilitar el grant «Passwordless OTP» en la aplicación de Auth0.'),
    "unsupported_grant_type": (503, 'Falta habilitar el grant «Passwordless OTP» en la aplicación de Auth0.'),
    "invalid_client": (503, "Auth0 rechazó las credenciales: revisá AUTH0_CLIENT_ID y AUTH0_CLIENT_SECRET."),
    "requires_verification": (409, "Auth0 pidió una verificación adicional. Intentá de nuevo en unos minutos."),
}


def _require(settings: Settings) -> None:
    if not settings.login_configured:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "El inicio de sesión no está configurado en el servidor.")


def _auth0_post(path: str, payload: dict, settings: Settings) -> dict:
    _require(settings)
    body = {"client_id": settings.auth0_client_id, "client_secret": settings.auth0_client_secret, **payload}
    try:
        res = httpx.post(f"https://{settings.auth0_domain}{path}", json=body, timeout=15)
    except httpx.HTTPError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "No se pudo conectar con Auth0.") from exc
    if res.status_code >= 400:
        try:
            data = res.json()
        except ValueError:
            data = {}
        code = data.get("error") or data.get("code") or ""
        estado, mensaje = ERRORES.get(code, (0, ""))
        if not estado:
            estado = 429 if res.status_code == 429 else 502
            mensaje = "No se pudo iniciar sesión. Intentá de nuevo."
            # Con «Disable Sign Ups» Auth0 rechaza correos que no son usuarios.
            descripcion = str(data.get("error_description") or data.get("description") or "").lower()
            if "signup" in descripcion or "sign up" in descripcion or "not allowed" in descripcion:
                estado, mensaje = 403, "Ese correo no tiene acceso al planificador. Pedí que te den de alta."
        raise HTTPException(estado, mensaje)
    try:
        return res.json()
    except ValueError:
        return {}


def _throttle(email: str) -> None:
    ahora = time.monotonic()
    with _code_lock:
        recientes = [t for t in _code_hits.get(email, []) if t > ahora - CODE_WINDOW]
        if len(recientes) >= CODE_LIMIT:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Se enviaron demasiados códigos a este correo. Esperá unos minutos.",
            )
        recientes.append(ahora)
        _code_hits[email] = recientes


def _is_https(request: Request) -> bool:
    return request.headers.get("x-forwarded-proto", request.url.scheme) == "https"


def _clear_cookie_headers() -> dict:
    holder = Response()
    holder.delete_cookie(COOKIE, path=COOKIE_PATH)
    return {"set-cookie": holder.headers["set-cookie"]}


def _session(response: Response, request: Request, tokens: dict) -> schemas.SessionOut:
    access_token = tokens.get("access_token")
    if not access_token:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Auth0 no devolvió la sesión.")
    if tokens.get("refresh_token"):
        response.set_cookie(
            COOKIE,
            tokens["refresh_token"],
            max_age=COOKIE_MAX_AGE,
            httponly=True,
            secure=_is_https(request),
            samesite="strict",
            path=COOKIE_PATH,
        )
    return schemas.SessionOut(access_token=access_token, expires_in=int(tokens.get("expires_in") or 3600))


@router.post("/code", status_code=status.HTTP_204_NO_CONTENT)
def enviar_codigo(data: schemas.LoginCodeIn, settings: Settings = Depends(get_settings)):
    _require(settings)
    email = data.email.lower()
    if not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Escribí tu correo electrónico.")
    _throttle(email)
    _auth0_post(
        "/passwordless/start",
        {"connection": settings.auth0_connection, "email": email, "send": "code"},
        settings,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/token", response_model=schemas.SessionOut)
def canjear_codigo(
    data: schemas.LoginVerifyIn, request: Request, response: Response, settings: Settings = Depends(get_settings),
):
    tokens = _auth0_post(
        "/oauth/token",
        {
            "grant_type": PASSWORDLESS_GRANT,
            "realm": settings.auth0_connection,
            "username": data.email.lower(),
            "otp": data.code,
            "audience": settings.auth0_audience,
            "scope": SCOPE,
        },
        settings,
    )
    return _session(response, request, tokens)


@router.post("/refresh", response_model=schemas.SessionOut)
def renovar(request: Request, response: Response, settings: Settings = Depends(get_settings)):
    _require(settings)
    refresh_token = request.cookies.get(COOKIE)
    if not refresh_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Iniciá sesión para continuar.")
    try:
        tokens = _auth0_post("/oauth/token", {"grant_type": "refresh_token", "refresh_token": refresh_token}, settings)
    except HTTPException as err:
        if err.status_code in (400, 401, 403):
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "Tu sesión expiró. Iniciá sesión de nuevo.",
                headers=_clear_cookie_headers(),
            ) from err
        raise
    return _session(response, request, tokens)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def cerrar_sesion(request: Request, settings: Settings = Depends(get_settings)):
    refresh_token = request.cookies.get(COOKIE)
    if refresh_token and settings.login_configured:
        # Revoca el refresh token en Auth0 para que no sirva aunque alguien lo hubiera copiado.
        try:
            httpx.post(
                f"https://{settings.auth0_domain}/oauth/revoke",
                json={
                    "client_id": settings.auth0_client_id,
                    "client_secret": settings.auth0_client_secret,
                    "token": refresh_token,
                },
                timeout=10,
            )
        except httpx.HTTPError:
            pass  # la cookie se borra igual
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(COOKIE, path=COOKIE_PATH)
    return response
