from pathlib import Path

PACIENTE = {
    "nombre": "Josefa Lindqvist",
    "pais": "Canadá",
    "email": "josefa@example.com",
    "sede": "santa-teresa",
    "tratamiento": "Smile Makeover",
    "arcos": 1,
    "llegada": {"ruta": "YYZ → SJO", "fecha": "2026-10-12T15:40"},
    "nacionalIda": {"ruta": "SJO → Cóbano", "fecha": "2026-10-13T08:30", "aplica": True},
    "pickup": {"ruta": "Aeropuerto → hotel", "fecha": "2026-10-13T09:45"},
    "hotel": {"nombre": "Hotel El Jardín", "checkin": "2026-10-13", "checkout": "2026-10-19"},
    "nacionalRegreso": {"ruta": "Cóbano → SJO", "fecha": "", "aplica": True},
    "salida": {"ruta": "SJO → YYZ", "fecha": "2026-10-20T13:15"},
    "pagos": {"total": 7550, "viajes": 2, "viaje1": {"monto": 4530, "estado": "pagado"}, "viaje2": {"monto": 3020, "estado": "pendiente"}},
    "seguro": {"aseguradora": "", "poliza": "", "estado": "pendiente"},
}


def test_crear_listar_actualizar_y_eliminar(auth_client):
    creado = auth_client.post("/api/pacientes", json=PACIENTE)
    assert creado.status_code == 201
    p = creado.json()
    assert p["nacionalIda"] == {"ruta": "SJO → Cóbano", "fecha": "2026-10-13T08:30", "vuelo": "", "aplica": True}
    assert p["pagos"]["viaje1"] == {"monto": 4530, "estado": "pagado"}
    assert p["documentos"] == [] and p["comentarios"] == [] and p["etapaManual"] is None

    assert [x["id"] for x in auth_client.get("/api/pacientes").json()] == [p["id"]]

    cambio = {**PACIENTE, "telefono": "+1 416 555 0000", "pagos": {**PACIENTE["pagos"], "viajes": 1}}
    actualizado = auth_client.put(f"/api/pacientes/{p['id']}", json=cambio).json()
    assert actualizado["telefono"] == "+1 416 555 0000"
    # Con pago único el segundo viaje queda en cero.
    assert actualizado["pagos"]["viaje2"]["monto"] == 0

    assert auth_client.delete(f"/api/pacientes/{p['id']}").status_code == 204
    assert auth_client.get(f"/api/pacientes/{p['id']}").status_code == 404


def test_sin_vuelo_nacional_se_limpian_los_tramos(auth_client):
    data = {**PACIENTE, "sede": "pavas", "nacionalIda": {"ruta": "SJO → Cóbano", "fecha": "2026-10-13T08:30", "aplica": False}}
    p = auth_client.post("/api/pacientes", json=data).json()
    assert p["nacionalIda"] == {"ruta": "", "fecha": "", "vuelo": "", "aplica": False}
    assert p["nacionalRegreso"]["aplica"] is False
    res = auth_client.patch(f"/api/pacientes/{p['id']}/etapa", json={"etapa": "nacionalIda"})
    assert res.status_code == 422


def test_validaciones(auth_client):
    assert auth_client.post("/api/pacientes", json={**PACIENTE, "email": "no-es-correo"}).status_code == 422
    assert auth_client.post("/api/pacientes", json={**PACIENTE, "sede": "marte"}).status_code == 422
    assert auth_client.post("/api/pacientes", json={**PACIENTE, "nombre": "   "}).status_code == 422
    fecha_mala = {**PACIENTE, "llegada": {"ruta": "", "fecha": "12/10/2026"}}
    res = auth_client.post("/api/pacientes", json=fecha_mala)
    assert res.status_code == 422
    assert "llegada" in res.json()["detail"]


def test_texto_con_sql_se_guarda_literal(auth_client):
    nombre = "Robert'); DROP TABLE pacientes;--"
    p = auth_client.post("/api/pacientes", json={**PACIENTE, "nombre": nombre}).json()
    assert p["nombre"] == nombre
    assert len(auth_client.get("/api/pacientes").json()) == 1


def test_etapa_manual(auth_client):
    p = auth_client.post("/api/pacientes", json=PACIENTE).json()
    assert auth_client.patch(f"/api/pacientes/{p['id']}/etapa", json={"etapa": "hotel"}).json()["etapaManual"] == "hotel"
    assert auth_client.patch(f"/api/pacientes/{p['id']}/etapa", json={"etapa": None}).json()["etapaManual"] is None
    assert auth_client.patch(f"/api/pacientes/{p['id']}/etapa", json={"etapa": "luna"}).status_code == 422


def test_comentario_registra_al_autor_del_token(auth_client):
    p = auth_client.post("/api/pacientes", json=PACIENTE).json()
    c = auth_client.post(f"/api/pacientes/{p['id']}/comentarios", json={"texto": "Prefiere planta baja."}).json()
    assert c["autor"] == "Ana Coordinadora"
    assert auth_client.get(f"/api/pacientes/{p['id']}").json()["comentarios"][0]["texto"] == "Prefiere planta baja."


PDF = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def test_documentos_subir_descargar_y_eliminar(auth_client):
    p = auth_client.post("/api/pacientes", json=PACIENTE).json()
    res = auth_client.post(
        f"/api/pacientes/{p['id']}/documentos",
        files={"archivo": ("../../etc/pasaporte.pdf", PDF, "application/pdf")},
        data={"tipo": "pasaporte"},
    )
    assert res.status_code == 201
    doc = res.json()
    assert doc["nombre"] == "pasaporte.pdf" and doc["tipo"] == "pasaporte"

    archivo = auth_client.get(f"/api/documentos/{doc['id']}/archivo")
    assert archivo.status_code == 200
    assert archivo.content == PDF
    assert archivo.headers["content-disposition"].startswith("attachment")

    assert auth_client.patch(f"/api/documentos/{doc['id']}", json={"tipo": "seguro"}).json()["tipo"] == "seguro"

    uploads = Path(__import__("os").environ["UPLOAD_DIR"])
    assert len(list(uploads.iterdir())) == 1
    assert auth_client.delete(f"/api/documentos/{doc['id']}").status_code == 204
    assert list(uploads.iterdir()) == []


def test_documentos_rechazados(auth_client):
    p = auth_client.post("/api/pacientes", json=PACIENTE).json()
    url = f"/api/pacientes/{p['id']}/documentos"
    html = auth_client.post(url, files={"archivo": ("falso.pdf", b"<html><script>alert(1)</script>", "application/pdf")})
    assert html.status_code == 415
    exe = auth_client.post(url, files={"archivo": ("programa.exe", b"MZ" + b"\x00" * 10, "application/octet-stream")})
    assert exe.status_code == 415
    grande = auth_client.post(url, files={"archivo": ("foto.png", PNG + b"\x00" * (1024 * 1024), "image/png")})
    assert grande.status_code == 413
    assert auth_client.get(f"/api/pacientes/{p['id']}").json()["documentos"] == []


def test_eliminar_paciente_borra_sus_archivos(auth_client):
    p = auth_client.post("/api/pacientes", json=PACIENTE).json()
    auth_client.post(f"/api/pacientes/{p['id']}/documentos", files={"archivo": ("rx.png", PNG, "image/png")})
    uploads = Path(__import__("os").environ["UPLOAD_DIR"])
    assert len(list(uploads.iterdir())) == 1
    auth_client.delete(f"/api/pacientes/{p['id']}")
    assert list(uploads.iterdir()) == []
