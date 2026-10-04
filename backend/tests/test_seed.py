from sqlalchemy import func, select

from app import models
from app.db import SessionLocal
from app.seed import seed_catalogos, seed_demo


def _contar(db, model):
    return db.scalar(select(func.count()).select_from(model))


def test_catalogos_borrados_no_vuelven_al_reiniciar():
    with SessionLocal() as db:  # conftest ya cargó los catálogos una vez
        assert _contar(db, models.Tratamiento) > 0
        db.query(models.Tratamiento).delete()
        db.query(models.Vuelo).delete()
        db.commit()

        seed_catalogos(db)  # lo que hace el contenedor en cada arranque
        assert _contar(db, models.Tratamiento) == 0
        assert _contar(db, models.Vuelo) == 0


def test_pacientes_demo_borrados_no_vuelven():
    with SessionLocal() as db:
        seed_demo(db)
        assert _contar(db, models.Paciente) > 0
        db.query(models.Paciente).delete()
        db.commit()

        seed_demo(db)
        assert _contar(db, models.Paciente) == 0
