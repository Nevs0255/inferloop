# MédiaLens — API de classification d'articles (livraison InferLoop J1)

API FastAPI qui classe un article de presse française en 5 catégories
(`politique, economie, sport, culture, faits_divers`) via un modèle **zero-shot**.

---

## 1. Décision modèle et trade-offs

Les poids fine-tunés d'Adrien (`pytorch_model.bin`, ~443 Mo) n'étant pas fournis,
on ne peut pas utiliser son CamemBERT. On part donc sur du **zero-shot NLI**.

Comparatif des candidats évalués :

| Modèle | Latence p99 (CPU) | Langue | Params | Macro-F1 | SLA <500ms |
|---|---|---|---|---|---|
| `facebook/bart-large-mnli` (reco note Adrien) | ~1800 ms | anglais | ~400M | non retenu | ❌ |
| **`MoritzLaurer/mDeBERTa-v3-base-mnli-xnli`** ✅ | **343 ms** | **français (XNLI)** | **~280M** | **0.713** | ✅ |

**Choix retenu : mDeBERTa-v3-base-mnli-xnli.** Justification :

- **Latence** : `bart-large-mnli` viole le SLA business de Chloé (p99 < 500 ms) —
  mesuré à ~650-1800 ms sur CPU (5 passes NLI d'un modèle ~400M). mDeBERTa tient
  le SLA avec ~5× de marge (p99 = 343 ms).
- **Qualité FR** : modèle NLI multilingue entraîné nativement sur le français,
  meilleur sur ce corpus qu'un modèle anglais avec labels traduits.
- **Taille** : ~280M params → image Docker plus légère.
- **Trade-off assumé** : macro-F1 de **0.71** contre **0.87** pour le modèle
  fine-tuné d'Adrien. Écart normal du zero-shot (aucun entraînement sur le
  corpus). Pour regagner ces points il faudrait les vrais poids ou un
  fine-tuning (hors périmètre J1).

### Réglage clé : gabarit d'hypothèse français

Le pipeline zero-shot utilise par défaut un gabarit **anglais**
(`"This example is {}."`). Le passer en français
(`"Cet article parle de {}."`) avec des labels lisibles apporte **+8 pts de
F1** (0.636 → 0.713). Vérifié sur les 3 configurations testées dans
`scripts/evaluate.py`.

---

## 2. Résultats de validation (`articles_test.csv`, 475 articles valides)

- **Accuracy : 0.731** · **Macro-F1 : 0.713**

| Classe | Precision | Recall | F1 |
|---|---|---|---|
| politique | 0.72 | 0.89 | 0.80 |
| economie | 0.64 | 0.31 | 0.41 |
| sport | 0.80 | 0.98 | 0.88 |
| culture | 0.89 | 0.77 | 0.83 |
| faits_divers | 0.59 | 0.71 | 0.64 |

**Point faible** : `economie` (recall 0.31) — souvent confondu avec `politique`
(budget, réformes) et `faits_divers` (affaires financières). Cohérent avec les
confusions déjà notées par Adrien.

### Latence (100 inférences à chaud, CPU)

| p50 | p95 | p99 | SLA |
|---|---|---|---|
| 240 ms | 290 ms | **343 ms** | < 500 ms ✅ |

---

## 3. Architecture

```
inferloop-j1/
├── app/
│   ├── inference.py   # chargement mDeBERTa (cache) + predict()
│   ├── main.py        # FastAPI : /infer, /health, / + sert /app/
│   └── static/
│       └── index.html # frontend de test cliquable (UI)
├── scripts/
│   ├── evaluate.py    # validation + comparaison de configs sur les 500 articles
│   └── benchmark.py   # mesure la latence p50/p95/p99 (preuve du SLA)
├── tests/
│   └── test_api.py    # 8 tests pytest (endpoints + validation + logique)
├── presentation/
│   ├── index.html     # deck web (Swiss Grid, 9 slides)
│   ├── guide.html     # guide complet (page web)
│   └── MediaLens-InferLoop-J1.pptx  # deck PowerPoint éditable
├── docs/
│   ├── note_adrien_modele.md  # note technique héritée d'Adrien
│   └── GUIDE-COMPLET.md        # guide détaillé + glossaire
├── Dockerfile         # image CPU, modèle pré-téléchargé au build
├── docker-compose.yml # lancement en une commande
├── requirements.txt   # dépendances figées (sentencepiece/sacremoses inclus)
└── SOLUTION.md        # ce document
```

Le modèle est chargé **une seule fois** au démarrage (lifespan FastAPI), donc
`/health` reflète l'état réel et la première requête `/infer` n'est pas pénalisée.

---

## 4. Endpoints

### `POST /infer`
```json
// requête
{"titre": "Les Bleus en finale", "texte": "L'équipe de France s'est qualifiée..."}
// réponse
{"categorie": "sport", "score": 0.908, "latence_ms": 250}
```
Validation Pydantic : `texte` non vide, sinon **HTTP 422**.

### `GET /health`
```json
{"status": "ok", "model_loaded": true}
```

### `GET /app/`
Frontend de test cliquable servi par l'API (même origine, aucun CORS) : voyant de
santé du modèle, 5 exemples pré-remplis, catégorie + score + latence par requête.

---

## 5. Lancer le projet

### En local
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Avec Docker (une seule commande)
```bash
docker compose up --build
```
Le modèle est téléchargé pendant le `build` : le conteneur démarre ensuite sans
réseau et `/health` passe `ok` en quelques secondes.

### Tester
Le plus simple : ouvrir **`http://127.0.0.1:8000/app/`** (frontend cliquable).
Sinon Swagger sur `http://127.0.0.1:8000/docs`, ou en ligne de commande :
```bash
pytest tests/ -v
python -m scripts.evaluate   # relance la validation sur les 500 articles
python -m scripts.benchmark  # mesure la latence p50/p95/p99 (preuve du SLA)
```

---

## 6. Limites connues

- Zero-shot → ~15 pts de F1 sous le modèle fine-tuné (pas d'entraînement corpus).
- `economie` sous-détectée (recall 0.31).
- Articles très courts (< 50 mots) moins fiables (déjà signalé par Adrien).
- Pas de monitoring de drift (piste J2).
- Image Docker relativement lourde (torch + modèle) — atténuée par le wheel
  CPU-only et le `.dockerignore`.
