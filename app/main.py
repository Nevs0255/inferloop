"""API FastAPI — classifieur d'articles MédiaLens.

Endpoints requis (cahier des charges de Chloé Renard) :
  - POST /infer   : classe un article {titre, texte} en 5 catégories.
  - GET  /health  : indique si le modèle est chargé.

Le modèle est chargé au démarrage (lifespan) pour que /health reflète l'état
réel et pour éviter la latence de chargement sur la première requête /infer.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.inference import LABELS, is_model_loaded, load_model, predict

# Dossier du frontend de test (servi en même origine → aucun souci CORS).
STATIC_DIR = Path(__file__).parent / "static"


class InferRequest(BaseModel):
    """Corps de requête pour POST /infer."""

    titre: str = Field(..., description="Titre de l'article")
    texte: str = Field(..., min_length=1, description="Corps de l'article")


class InferResponse(BaseModel):
    """Réponse de POST /infer."""

    categorie: str = Field(..., description="Catégorie prédite (une des 5)")
    score: float = Field(..., ge=0.0, le=1.0, description="Confiance [0,1]")
    latence_ms: int = Field(..., ge=0, description="Latence d'inférence (ms)")


class HealthResponse(BaseModel):
    """Réponse de GET /health."""

    status: str
    model_loaded: bool


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Charge le modèle une fois au démarrage du serveur."""
    load_model()
    yield


app = FastAPI(
    title="MédiaLens — Classifieur d'articles",
    version="1.0.0",
    description="Classification zero-shot d'articles de presse française.",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Vérifie que le service est vivant et que le modèle est chargé."""
    loaded = is_model_loaded()
    return HealthResponse(
        status="ok" if loaded else "loading",
        model_loaded=loaded,
    )


@app.post("/infer", response_model=InferResponse)
def infer(request: InferRequest) -> InferResponse:
    """Classe un article et renvoie catégorie, score et latence."""
    result = predict(request.titre, request.texte)
    return InferResponse(**result)


@app.get("/")
def root() -> dict:
    """Métadonnées du service."""
    return {
        "service": "medialens-classifier",
        "categories": LABELS,
        "endpoints": ["POST /infer", "GET /health"],
        "ui": "/app/",
    }


# Frontend de test cliquable (mDeBERTa) servi sur /app/ — même origine que
# /infer et /health, donc pas de configuration CORS nécessaire.
app.mount("/app", StaticFiles(directory=STATIC_DIR, html=True), name="ui")
