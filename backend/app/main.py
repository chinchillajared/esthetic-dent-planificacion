"""API del Planificador de pacientes · Esthetic Dent International."""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import get_settings
from .routers import catalogos, pacientes, sesion, sistema, vuelos_estado

settings = get_settings()

app = FastAPI(
    title="Planificador de pacientes API",
    version="1.0.0",
    # La documentación interactiva solo se publica en desarrollo.
    docs_url="/api/docs" if settings.environment == "development" else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.environment == "development" else None,
)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    # Mensaje legible para el usuario; el detalle técnico queda en "errores".
    first = exc.errors()[0] if exc.errors() else {}
    campo = ".".join(str(p) for p in first.get("loc", [])[1:])
    mensaje = first.get("msg", "Datos inválidos.").removeprefix("Value error, ")
    return JSONResponse(
        status_code=422,
        content={
            "detail": f"Revisá el campo «{campo}»: {mensaje}" if campo else mensaje,
            "errores": [{"loc": list(e.get("loc", [])), "msg": e.get("msg", ""), "type": e.get("type", "")} for e in exc.errors()],
        },
    )


@app.middleware("http")
async def no_store_api(request: Request, call_next):
    response = await call_next(request)
    # Los datos de pacientes nunca se guardan en cachés intermedias ni del navegador.
    response.headers.setdefault("Cache-Control", "no-store")
    return response


app.include_router(sistema.router)
app.include_router(sesion.router)
app.include_router(catalogos.router)
app.include_router(pacientes.router)
app.include_router(vuelos_estado.router)
