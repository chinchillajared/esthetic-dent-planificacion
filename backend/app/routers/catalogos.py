"""Catálogos de Configuración: sedes, tratamientos, hoteles y vuelos."""
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..db import get_db
from ..mappers import clave, tratamiento_out, vuelo_out

router = APIRouter(prefix="/api", tags=["catálogos"], dependencies=[Depends(get_current_user)])


def _conflict(message: str) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, message)


def _codigo(value: str) -> str:
    """Códigos IATA de 3 letras en mayúscula; nombres como «Cóbano» se respetan."""
    value = " ".join(value.split())
    return value.upper() if len(value) == 3 and value.isalpha() else value


@router.get("/catalogos", response_model=schemas.Catalogos)
def listar(db: Session = Depends(get_db)):
    return schemas.Catalogos(
        sedes=[schemas.SedeOut(id=s.id, nombre=s.nombre) for s in db.scalars(select(models.Sede).order_by(models.Sede.nombre))],
        tratamientos=[tratamiento_out(t) for t in db.scalars(select(models.Tratamiento).order_by(models.Tratamiento.id))],
        hoteles=[schemas.HotelOut(id=h.id, nombre=h.nombre) for h in db.scalars(select(models.Hotel).order_by(models.Hotel.id))],
        vuelos=[vuelo_out(v) for v in db.scalars(select(models.Vuelo).order_by(models.Vuelo.id))],
    )


# ---------- Sedes ----------

def _slug(db: Session, nombre: str) -> str:
    base = "-".join(clave(nombre).replace("-", " ").split()) or "sede"
    base = "".join(ch for ch in base if ch.isalnum() or ch == "-")[:56] or "sede"
    slug, n = base, 2
    while db.get(models.Sede, slug):
        slug, n = f"{base}-{n}", n + 1
    return slug


@router.post("/sedes", response_model=schemas.SedeOut, status_code=status.HTTP_201_CREATED)
def crear_sede(data: schemas.SedeIn, db: Session = Depends(get_db)):
    existing = db.scalar(select(models.Sede).where(models.Sede.clave == clave(data.nombre)))
    if existing:
        raise _conflict(f"Ya existe la sede {existing.nombre}.")
    sede = models.Sede(id=_slug(db, data.nombre), nombre=data.nombre, clave=clave(data.nombre))
    db.add(sede)
    db.commit()
    return schemas.SedeOut(id=sede.id, nombre=sede.nombre)


@router.delete("/sedes/{sede_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_sede(sede_id: str, db: Session = Depends(get_db)):
    sede = db.get(models.Sede, sede_id)
    if not sede:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "La sede no existe.")
    en_uso = db.scalar(select(func.count()).select_from(models.Paciente).where(models.Paciente.sede_id == sede_id))
    if en_uso:
        raise _conflict(f"No se puede eliminar {sede.nombre}: tiene {en_uso} paciente(s) asignado(s).")
    if db.scalar(select(func.count()).select_from(models.Sede)) <= 1:
        raise _conflict("Debe quedar al menos una sede.")
    db.delete(sede)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- Tratamientos ----------

@router.post("/tratamientos", response_model=schemas.TratamientoOut, status_code=status.HTTP_201_CREATED)
def crear_tratamiento(data: schemas.TratamientoIn, db: Session = Depends(get_db)):
    existing = db.scalar(select(models.Tratamiento).where(models.Tratamiento.clave == clave(data.nombre)))
    if existing:
        raise _conflict(f"{existing.nombre} ya está en la lista de tratamientos.")
    t = models.Tratamiento(
        nombre=data.nombre, clave=clave(data.nombre), precio=Decimal(str(data.precio)),
        moneda=data.moneda, viajes=data.viajes, arcos=data.arcos,
    )
    db.add(t)
    db.commit()
    return tratamiento_out(t)


@router.delete("/tratamientos/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_tratamiento(item_id: int, db: Session = Depends(get_db)):
    return _delete(db, models.Tratamiento, item_id, "El tratamiento no existe.")


# ---------- Hoteles ----------

@router.post("/hoteles", response_model=schemas.HotelOut, status_code=status.HTTP_201_CREATED)
def crear_hotel(data: schemas.HotelIn, db: Session = Depends(get_db)):
    existing = db.scalar(select(models.Hotel).where(models.Hotel.clave == clave(data.nombre)))
    if existing:
        raise _conflict(f"{existing.nombre} ya está en la lista de hoteles.")
    h = models.Hotel(nombre=data.nombre, clave=clave(data.nombre))
    db.add(h)
    db.commit()
    return schemas.HotelOut(id=h.id, nombre=h.nombre)


@router.delete("/hoteles/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_hotel(item_id: int, db: Session = Depends(get_db)):
    return _delete(db, models.Hotel, item_id, "El hotel no existe.")


# ---------- Vuelos ----------

@router.post("/vuelos", response_model=schemas.VueloOut, status_code=status.HTTP_201_CREATED)
def crear_vuelo(data: schemas.VueloIn, db: Session = Depends(get_db)):
    origen, destino = _codigo(data.origen), _codigo(data.destino)
    if clave(origen) == clave(destino):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "El origen y el destino deben ser aeropuertos distintos.")
    existing = db.scalar(select(models.Vuelo).where(
        models.Vuelo.clave_origen == clave(origen), models.Vuelo.clave_destino == clave(destino),
    ))
    if existing:
        raise _conflict(f"La ruta {existing.origen} → {existing.destino} ya está registrada.")
    v = models.Vuelo(
        tipo=data.tipo, origen=origen, destino=destino, clave_origen=clave(origen), clave_destino=clave(destino),
        precio=None if data.precio is None else Decimal(str(data.precio)), moneda=data.moneda,
    )
    db.add(v)
    db.commit()
    return vuelo_out(v)


@router.delete("/vuelos/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_vuelo(item_id: int, db: Session = Depends(get_db)):
    return _delete(db, models.Vuelo, item_id, "El vuelo no existe.")


def _delete(db: Session, model, item_id: int, missing: str) -> Response:
    item = db.get(model, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, missing)
    db.delete(item)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

