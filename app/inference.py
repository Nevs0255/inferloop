"""Module d'inférence — classifieur d'articles MédiaLens.

Stratégie modèle (décidée au Jour 1) : classification *zero-shot* avec
`MoritzLaurer/mDeBERTa-v3-base-mnli-xnli`, faute des poids fine-tunés d'Adrien
(~443 Mo non fournis). Ce modèle NLI multilingue est entraîné nativement sur le
français (XNLI), plus léger que bart-large-mnli (~280M vs ~400M params) et tient
le SLA de latence (< 500 ms p99 CPU), contrairement à bart-large-mnli mesuré
à ~650-1800 ms. Le modèle est chargé une seule fois (au démarrage de l'API) et
réutilisé pour toutes les requêtes.

Voir le README pour les trade-offs (taille image / latence / qualité).
"""

from __future__ import annotations

import time
from functools import lru_cache

from transformers import pipeline

# Modèle zero-shot retenu : NLI multilingue français-natif, plus léger et plus
# rapide que bart-large-mnli (qui dépassait le SLA de latence sur CPU).
MODEL_NAME = "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli"

# Les 5 catégories cibles MédiaLens (labels canoniques renvoyés par l'API).
LABELS = ["politique", "economie", "sport", "culture", "faits_divers"]

# Labels "candidats" en français lisible, PARALLÈLES à LABELS (même ordre),
# soumis au modèle NLI. Combinés au gabarit français ci-dessous, ils donnent
# le meilleur macro-F1 (0.71) sur articles_test.csv — cf. scripts/evaluate.py.
# La prédiction est re-mappée sur le label canonique correspondant par position.
CANDIDATE_LABELS = ["politique", "économie", "sport", "culture", "faits divers"]

# Gabarit d'hypothèse en français (le défaut anglais "This example is {}."
# faisait perdre ~8 pts de F1 sur ce corpus).
HYPOTHESIS_TEMPLATE = "Cet article parle de {}."

# Longueur max de la séquence d'entrée (caractères). Sécurise la latence :
# les articles longs sont tronqués avant tokenization.
MAX_INPUT_CHARS = 1024


@lru_cache(maxsize=1)
def load_model():
    """Charge et met en cache le pipeline zero-shot (une seule fois).

    Le `lru_cache` garantit qu'un seul objet pipeline vit dans le process,
    même si `load_model()` est appelé plusieurs fois.
    """
    return pipeline(
        "zero-shot-classification",
        model=MODEL_NAME,
        device=-1,  # CPU
    )


def is_model_loaded() -> bool:
    """Indique si le modèle est déjà chargé en mémoire (pour /health)."""
    return load_model.cache_info().currsize > 0


def build_input(titre: str, texte: str) -> str:
    """Construit la séquence d'entrée à partir du titre et du texte.

    Adrien concaténait `titre + [SEP] + texte` pour son CamemBERT fine-tuné
    (+3 pts de F1). En zero-shot NLI le `[SEP]` explicite n'a pas le même rôle,
    on concatène donc titre puis texte en une seule prémisse, tronquée pour
    borner la latence.
    """
    titre = (titre or "").strip()
    texte = (texte or "").strip()
    sequence = f"{titre}. {texte}".strip()
    return sequence[:MAX_INPUT_CHARS]


def predict(titre: str, texte: str) -> dict:
    """Classe un article et renvoie la catégorie, le score et la latence.

    Returns:
        dict: {"categorie": str, "score": float, "latence_ms": int}
    """
    classifier = load_model()
    sequence = build_input(titre, texte)

    t0 = time.perf_counter()
    result = classifier(
        sequence,
        candidate_labels=CANDIDATE_LABELS,
        hypothesis_template=HYPOTHESIS_TEMPLATE,
    )
    latence_ms = int((time.perf_counter() - t0) * 1000)

    # Le pipeline renvoie labels/scores triés par score décroissant. On re-mappe
    # le label candidat gagnant sur son label canonique (même position).
    winner = result["labels"][0]
    categorie = LABELS[CANDIDATE_LABELS.index(winner)]
    return {
        "categorie": categorie,
        "score": round(float(result["scores"][0]), 3),
        "latence_ms": latence_ms,
    }
