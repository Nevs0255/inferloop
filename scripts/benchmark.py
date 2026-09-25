"""Benchmark de latence du classifieur — reproduit les chiffres du guide/deck.

Charge le modèle une fois, fait quelques inférences de chauffe, puis chronomètre
N inférences à chaud sur un panel d'articles représentatifs. Affiche p50/p95/p99
et le verdict SLA (< 500 ms p99).

Usage :
    .venv/bin/python -m scripts.benchmark            # 100 mesures (défaut)
    .venv/bin/python -m scripts.benchmark --runs 200
"""

from __future__ import annotations

import argparse
import statistics

from app.inference import load_model, predict

# SLA business (cf. cahier des charges de Chloé).
SLA_MS = 500

# Panel d'articles couvrant les 5 catégories (mélange court / long).
SAMPLES = [
    ("Budget 2025 adopté",
     "Après trois semaines de débats et un 49-3, les députés ont voté le PLF "
     "visant un déficit à 3,2 pourcent du PIB."),
    ("Les Bleus en finale",
     "L'équipe de France de football s'est qualifiée pour la finale après une "
     "victoire 2-1 en demi-finale."),
    ("La Bourse de Paris monte",
     "Le CAC 40 clôture en hausse de 1,2 pourcent porté par les valeurs bancaires."),
    ("Cannes ouvre",
     "Le festival de Cannes a ouvert avec un film franco-américain en compétition "
     "officielle."),
    ("Incendie à Lyon",
     "Un incendie s'est déclaré dans un entrepôt industriel de la banlieue sans "
     "faire de victimes."),
]


def percentile(sorted_values: list[int], q: float) -> int:
    """Percentile simple (nearest-rank) sur une liste déjà triée."""
    if not sorted_values:
        return 0
    idx = min(int(q * len(sorted_values)), len(sorted_values) - 1)
    return sorted_values[idx]


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark de latence.")
    parser.add_argument("--runs", type=int, default=100,
                        help="Nombre total d'inférences chronométrées (défaut 100).")
    parser.add_argument("--warmup", type=int, default=3,
                        help="Inférences de chauffe non mesurées (défaut 3).")
    args = parser.parse_args()

    print("Chargement du modèle...")
    load_model()

    # Chauffe (JIT / caches internes) — non mesurée.
    for _ in range(args.warmup):
        predict(*SAMPLES[0])

    print(f"Mesure de {args.runs} inférences à chaud (CPU)...\n")
    latences: list[int] = []
    i = 0
    while len(latences) < args.runs:
        titre, texte = SAMPLES[i % len(SAMPLES)]
        latences.append(predict(titre, texte)["latence_ms"])
        i += 1

    latences.sort()
    p50 = statistics.median(latences)
    p95 = percentile(latences, 0.95)
    p99 = percentile(latences, 0.99)

    print(f"  N        : {len(latences)}")
    print(f"  p50      : {p50} ms")
    print(f"  p95      : {p95} ms")
    print(f"  p99      : {p99} ms")
    print(f"  max      : {max(latences)} ms")
    print(f"\n  SLA cible : < {SLA_MS} ms (p99)")
    print(f"  Verdict   : {'✓ OK' if p99 < SLA_MS else '✗ HORS SLA'}")


if __name__ == "__main__":
    main()
