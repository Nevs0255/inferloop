"""Validation du classifieur sur articles_test.csv.

Compare plusieurs configurations zero-shot (jeu de labels + gabarit d'hypothèse)
sur les 500 articles annotés, et reporte accuracy + F1 macro + rapport par
classe. Sert à *choisir sur des chiffres réels* la meilleure configuration,
plutôt qu'à l'œil sur quelques exemples.

Usage :
    .venv/bin/python -m scripts.evaluate
"""

from __future__ import annotations

import time

import pandas as pd
from sklearn.metrics import accuracy_score, classification_report, f1_score

from app.inference import build_input, load_model

CSV_PATH = "articles_test/articles_test.csv"

# Labels canoniques attendus en sortie (ordre de référence).
CANON = ["politique", "economie", "sport", "culture", "faits_divers"]

# Configurations à comparer. Chaque config fournit une liste de labels
# "candidats" PARALLÈLE à CANON (même ordre) : la prédiction est re-mappée sur
# le label canonique par position.
CONFIGS = [
    {
        "name": "A. labels bruts + gabarit EN (défaut)",
        "candidates": CANON,
        "template": "This example is {}.",
    },
    {
        "name": "B. labels FR lisibles + gabarit FR",
        "candidates": ["politique", "économie", "sport", "culture", "faits divers"],
        "template": "Cet article parle de {}.",
    },
    {
        "name": "C. labels FR descriptifs + gabarit FR",
        "candidates": [
            "politique",
            "économie et finance",
            "sport",
            "culture et arts",
            "fait divers, crime ou accident",
        ],
        "template": "Cet article parle de {}.",
    },
]


def load_data() -> pd.DataFrame:
    """Charge et nettoie le jeu de test (même nettoyage que le notebook)."""
    df = pd.read_csv(CSV_PATH)
    df = df.dropna(subset=["texte"])
    df = df[df["texte"].str.len() > 10]
    df = df[df["texte"] != "N/A"]
    df["input"] = [build_input(t, x) for t, x in zip(df["titre"], df["texte"])]
    return df.reset_index(drop=True)


def evaluate_config(clf, df: pd.DataFrame, config: dict) -> dict:
    """Évalue une configuration et renvoie ses métriques."""
    candidates = config["candidates"]
    template = config["template"]
    # Mapping label-candidat -> label canonique (par position).
    to_canon = {cand: CANON[i] for i, cand in enumerate(candidates)}

    inputs = df["input"].tolist()
    t0 = time.perf_counter()
    results = clf(
        inputs,
        candidate_labels=candidates,
        hypothesis_template=template,
        batch_size=16,
    )
    elapsed = time.perf_counter() - t0

    preds = [to_canon[r["labels"][0]] for r in results]
    y_true = df["categorie"].tolist()

    return {
        "name": config["name"],
        "accuracy": accuracy_score(y_true, preds),
        "f1_macro": f1_score(y_true, preds, average="macro"),
        "report": classification_report(y_true, preds, labels=CANON, zero_division=0),
        "sec_per_article": elapsed / len(inputs),
        "preds": preds,
        "y_true": y_true,
    }


def main() -> None:
    print("Chargement du modèle...")
    clf = load_model()
    df = load_data()
    print(f"Jeu de test nettoyé : {len(df)} articles\n")
    print("Distribution réelle :")
    print(df["categorie"].value_counts().to_string(), "\n")

    scored = []
    for config in CONFIGS:
        print(f"→ Évaluation : {config['name']} ...")
        res = evaluate_config(clf, df, config)
        scored.append(res)
        print(
            f"   accuracy={res['accuracy']:.3f} | "
            f"f1_macro={res['f1_macro']:.3f} | "
            f"{res['sec_per_article']*1000:.0f} ms/article\n"
        )

    best = max(scored, key=lambda r: r["f1_macro"])
    print("=" * 60)
    print(f"MEILLEURE CONFIG : {best['name']}")
    print(f"  accuracy = {best['accuracy']:.3f} | f1_macro = {best['f1_macro']:.3f}")
    print("=" * 60)
    print(best["report"])


if __name__ == "__main__":
    main()
