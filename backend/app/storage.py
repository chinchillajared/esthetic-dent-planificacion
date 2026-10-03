"""Almacenamiento de documentos en un volumen privado (fuera de la carpeta pública de nginx)."""
import secrets
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from .config import Settings

# Extensión permitida → (tipo MIME, firma de los primeros bytes)
ALLOWED = {
    ".pdf": ("application/pdf", (b"%PDF-",)),
    ".jpg": ("image/jpeg", (b"\xff\xd8\xff",)),
    ".jpeg": ("image/jpeg", (b"\xff\xd8\xff",)),
    ".png": ("image/png", (b"\x89PNG\r\n\x1a\n",)),
}
CHUNK = 1024 * 1024


def _safe_name(filename: str) -> str:
    # Solo se conserva el nombre visible (sin rutas) y sin caracteres de control.
    name = Path(filename or "documento").name
    name = "".join(ch for ch in name if ch.isprintable() and ch not in '\\/:*?"<>|').strip()
    return (name or "documento")[:255]


async def save_upload(upload: UploadFile, settings: Settings) -> tuple[str, str, str, int]:
    """Valida y guarda el archivo. Devuelve (nombre visible, tipo MIME, clave de almacenamiento, tamaño)."""
    nombre = _safe_name(upload.filename or "")
    ext = Path(nombre).suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, f"«{nombre}» no es PDF, JPG ni PNG.")
    content_type, signatures = ALLOWED[ext]

    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    key = secrets.token_hex(16) + ext
    target = settings.upload_dir / key
    size = 0
    head = b""
    try:
        with target.open("wb") as out:
            while chunk := await upload.read(CHUNK):
                if not head:
                    head = chunk[:16]
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise HTTPException(
                        status.HTTP_413_CONTENT_TOO_LARGE,
                        f"«{nombre}» supera los {settings.max_upload_mb} MB.",
                    )
                out.write(chunk)
        if size == 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"«{nombre}» está vacío.")
        # El contenido debe coincidir con la extensión (evita, p. ej., un HTML renombrado a .pdf).
        if not any(head.startswith(sig) for sig in signatures):
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, f"El contenido de «{nombre}» no corresponde a su formato.")
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    return nombre, content_type, key, size


def file_path(key: str, settings: Settings) -> Path:
    path = (settings.upload_dir / key).resolve()
    if path.parent != settings.upload_dir.resolve():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Documento no encontrado.")
    return path


def delete_file(key: str, settings: Settings) -> None:
    file_path(key, settings).unlink(missing_ok=True)
