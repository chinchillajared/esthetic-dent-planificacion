def test_catalogos_iniciales(auth_client):
    data = auth_client.get("/api/catalogos").json()
    assert [s["nombre"] for s in data["sedes"]] == ["Cóbano", "Pavas", "Santa Teresa"]
    assert any(t["nombre"] == "All-on-4" and t["arcos"] == 1 for t in data["tratamientos"])
    assert len(data["vuelos"]) == 16


def test_sede_duplicada_sin_importar_tildes(auth_client):
    res = auth_client.post("/api/sedes", json={"nombre": "  cobano "})
    assert res.status_code == 409
    assert "Cóbano" in res.json()["detail"]

    nueva = auth_client.post("/api/sedes", json={"nombre": "Tamarindo"})
    assert nueva.status_code == 201
    assert nueva.json() == {"id": "tamarindo", "nombre": "Tamarindo"}


def test_no_se_elimina_sede_con_pacientes(auth_client):
    auth_client.post("/api/pacientes", json={"nombre": "Paciente", "sede": "pavas"})
    res = auth_client.delete("/api/sedes/pavas")
    assert res.status_code == 409
    assert auth_client.delete("/api/sedes/cobano").status_code == 204


def test_tratamiento_valida_precio_y_arcos(auth_client):
    assert auth_client.post("/api/tratamientos", json={"nombre": "X", "precio": -1}).status_code == 422
    assert auth_client.post("/api/tratamientos", json={"nombre": "X", "precio": 10, "arcos": 3}).status_code == 422
    ok = auth_client.post(
        "/api/tratamientos", json={"nombre": "Blanqueamiento", "precio": 150000, "moneda": "CRC", "viajes": 1},
    )
    assert ok.status_code == 201
    assert ok.json()["arcos"] is None


def test_vuelos_codigos_y_duplicados(auth_client):
    res = auth_client.post("/api/vuelos", json={"tipo": "internacional", "origen": "jfk", "destino": "sjo"})
    assert res.status_code == 201
    assert (res.json()["origen"], res.json()["destino"], res.json()["precio"]) == ("JFK", "SJO", None)
    assert auth_client.post("/api/vuelos", json={"tipo": "internacional", "origen": "JFK", "destino": "SJO"}).status_code == 409
    assert auth_client.post("/api/vuelos", json={"tipo": "nacional", "origen": "SJO", "destino": "sjo"}).status_code == 422
    con_precio = auth_client.post(
        "/api/vuelos", json={"tipo": "nacional", "origen": "SJO", "destino": "LIR", "precio": 48000, "moneda": "CRC"},
    )
    assert con_precio.json()["precio"] == 48000


def test_campos_desconocidos_son_rechazados(auth_client):
    res = auth_client.post("/api/hoteles", json={"nombre": "Hotel", "admin": True})
    assert res.status_code == 422
