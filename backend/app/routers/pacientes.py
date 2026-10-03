"""Pacientes, su etapa manual, documentos y comentarios."""
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas, storage
from ..auth import User, get_current_user
from ..config import Settings, get_settings
from ..db import get_db
from ..mappers import apply_paciente, comentario_out, documento_out, paciente_out

router = APIRouter(prefix="/api", tags=["pacientes"])


def _get_paciente(db: Session, paciente_id: str) -> models.Paciente:
    paciente = db.scalar(
        select(models.Paciente)
        .where(models.Paciente.id == paciente_id)
        .options(selectinload(models.Paciente.documentos), selectinload(models.Paciente.comentarios)),
    )
    if not paciente:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "El paciente no existe.")
    return paciente


def _check_sede(db: Session, sede_id: str) -> None:
    if not db.get(models.Sede, sede_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "La sede elegida no existe.")


@router.get("/pacientes", response_model=list[schemas.PacienteOut])
def listar(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    pacientes = db.scalars(
        select(models.Paciente)
        .options(selectinload(models.Paciente.documentos), selectinload(models.Paciente.comentarios))
        .order_by(models.Paciente.llegada_fecha.is_(None), models.Paciente.llegada_fecha, models.Paciente.nombre),
    )
    return [paciente_out(p) for p in pacientes]


@router.get("/pacientes/{paciente_id}", response_model=schemas.PacienteOut)
def obtener(paciente_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return paciente_out(_get_paciente(db, paciente_id))


@router.post("/pacientes", response_model=schemas.PacienteOut, status_code=status.HTTP_201_CREATED)
def crear(data: schemas.PacienteIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _check_sede(db, data.sede)
    paciente = models.Paciente(created_by=user.nombre, updated_by=user.nombre)
    apply_paciente(paciente, data)
    db.add(paciente)
    db.commit()
    return paciente_out(_get_paciente(db, paciente.id))


@router.put("/pacientes/{paciente_id}", response_model=schemas.PacienteOut)
def actualizar(
    paciente_id: str, data: schemas.PacienteIn, db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    paciente = _get_paciente(db, paciente_id)
    _check_sede(db, data.sede)
    apply_paciente(paciente, data)
    paciente.updated_by = user.nombre
    db.commit()
    return paciente_out(_get_paciente(db, paciente_id))


@router.delete("/pacientes/{paciente_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar(
    paciente_id: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _: User = Depends(get_current_user),
):
    paciente = _get_paciente(db, paciente_id)
    keys = [d.storage_key for d in paciente.documentos]
    db.delete(paciente)
    db.commit()
    for key in keys:
        storage.delete_file(key, settings)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/pacientes/{paciente_id}/etapa", response_model=schemas.PacienteOut)
def cambiar_etapa(
    paciente_id: str, data: schemas.EtapaIn, db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    paciente = _get_paciente(db, paciente_id)
    if data.etapa in ("nacionalIda", "nacionalRegreso") and not paciente.vuelo_nacional:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Este paciente no tiene vuelo nacional.")
    paciente.etapa_manual = data.etapa
    paciente.updated_by = user.nombre
    db.commit()
    return paciente_out(_get_paciente(db, paciente_id))


# ---------- Comentarios ----------

@router.post(
    "/pacientes/{paciente_id}/comentarios", response_model=schemas.ComentarioOut, status_code=status.HTTP_201_CREATED,
)
def comentar(
    paciente_id: str,
    data: schemas.ComentarioIn,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    user: User = Depends(get_current_user),
):
    _get_paciente(db, paciente_id)
    ahora = datetime.now(ZoneInfo(settings.timezone)).replace(tzinfo=None, second=0, microsecond=0)
    comentario = models.Comentario(
        paciente_id=paciente_id, autor=user.nombre, autor_sub=user.sub, texto=data.texto, fecha=ahora,
    )
    db.add(comentario)
    db.commit()
    return comentario_out(comentario)


# ---------- Documentos ----------

@router.post(
    "/pacientes/{paciente_id}/documentos", response_model=schemas.DocumentoOut, status_code=status.HTTP_201_CREATED,
)
async def subir_documento(
    paciente_id: str,
    archivo: UploadFile = File(...),
    tipo: schemas.TipoDocumento = Form("otro"),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    user: User = Depends(get_current_user),
):
    _get_paciente(db, paciente_id)
    nombre, content_type, key, size = await storage.save_upload(archivo, settings)
    hoy = datetime.now(ZoneInfo(settings.timezone)).date()
    documento = models.Documento(
        paciente_id=paciente_id, nombre=nombre, tipo=tipo, fecha=hoy, content_type=content_type,
        tamano=size, storage_key=key, created_by=user.nombre,
    )
    db.add(documento)
    try:
        db.commit()
    except Exception:
        storage.delete_file(key, settings)
        raise
    return documento_out(documento)


def _get_documento(db: Session, documento_id: str) -> models.Documento:
    documento = db.get(models.Documento, documento_id)
    if not documento:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Documento no encontrado.")
    return documento


@router.patch("/documentos/{documento_id}", response_model=schemas.DocumentoOut)
def cambiar_tipo(
    documento_id: str, data: schemas.DocumentoUpdate, db: Session = Depends(get_db), _: User = Depends(get_current_user),
):
    documento = _get_documento(db, documento_id)
    documento.tipo = data.tipo
    db.commit()
    return documento_out(documento)


@router.delete("/documentos/{documento_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_documento(
    documento_id: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _: User = Depends(get_current_user),
):
    documento = _get_documento(db, documento_id)
    key = documento.storage_key
    db.delete(documento)
    db.commit()
    storage.delete_file(key, settings)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/documentos/{documento_id}/archivo")
def descargar(
    documento_id: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _: User = Depends(get_current_user),
):
    documento = _get_documento(db, documento_id)
    path = storage.file_path(documento.storage_key, settings)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "El archivo ya no está disponible.")
    return FileResponse(
        path,
        media_type=documento.content_type,
        filename=documento.nombre,
        content_disposition_type="attachment",
        headers={"Cache-Control": "no-store"},
    )
