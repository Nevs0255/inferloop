"""Tests de l'API MédiaLens.

Couvre les endpoints /health et /infer (contrat de sortie, validation) et la
logique d'inférence (concaténation titre/texte, re-mapping des labels).

Le modèle est chargé une fois au démarrage du TestClient (lifespan), ce qui
rend la première exécution un peu longue (téléchargement/chargement mDeBERTa).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.inference import LABELS, build_input
from app.main import app


@pytest.fixture(scope="module")
def client():
    """TestClient qui déclenche le lifespan (chargement du modèle)."""
    with TestClient(app) as c:
        yield c


# --- /health ---------------------------------------------------------------


def test_health_ok(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["model_loaded"] is True


# --- /infer : contrat de sortie -------------------------------------------


def test_infer_response_shape(client):
    payload = {
        "titre": "Les Bleus en finale",
        "texte": "L'équipe de France de football s'est qualifiée pour la finale "
        "après une victoire 2-1 en demi-finale.",
    }
    resp = client.post("/infer", json=payload)
    assert resp.status_code == 200
    body = resp.json()

    # Le contrat exact demandé par Chloé.
    assert set(body.keys()) == {"categorie", "score", "latence_ms"}
    assert body["categorie"] in LABELS
    assert 0.0 <= body["score"] <= 1.0
    assert isinstance(body["latence_ms"], int)
    assert body["latence_ms"] >= 0


def test_infer_sport_is_correct(client):
    """Cas non ambigu : un article de foot doit être classé 'sport'."""
    payload = {
        "titre": "Victoire des Bleus",
        "texte": "L'équipe de France de football a battu l'Allemagne 3-0 "
        "en match amical au Stade de France.",
    }
    resp = client.post("/infer", json=payload)
    assert resp.json()["categorie"] == "sport"


# --- /infer : validation ---------------------------------------------------


def test_infer_missing_texte_returns_422(client):
    resp = client.post("/infer", json={"titre": "titre seul"})
    assert resp.status_code == 422


def test_infer_empty_texte_returns_422(client):
    resp = client.post("/infer", json={"titre": "t", "texte": ""})
    assert resp.status_code == 422


# --- inférence : logique unitaire -----------------------------------------


def test_build_input_concatenates_titre_and_texte():
    out = build_input("Mon titre", "Mon texte")
    assert "Mon titre" in out
    assert "Mon texte" in out


def test_build_input_truncates_long_text():
    from app.inference import MAX_INPUT_CHARS

    out = build_input("t", "x" * 5000)
    assert len(out) <= MAX_INPUT_CHARS


def test_build_input_handles_missing_titre():
    out = build_input("", "texte seul")
    assert "texte seul" in out
