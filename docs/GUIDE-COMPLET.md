# Guide complet — Classifieur d'articles MédiaLens (InferLoop J1)

> Document pédagogique pour **expliquer tout ce qu'on a fait** : le raisonnement,
> les décisions, le fonctionnement technique, comment lancer et tester, et un
> glossaire des termes. Complète `SOLUTION.md` (résumé) et la note d'Adrien.

---

## 0. En une phrase

On a construit une **API web** qui reçoit un article de presse (titre + texte) et
répond automatiquement sa **catégorie** (politique, économie, sport, culture,
faits_divers), avec un **score de confiance** et le **temps de calcul**, le tout
packagé dans **Docker** et couvert par des **tests**.

---

## 1. Le contexte et le problème

MédiaLens (entreprise fictive du workshop) voulait classer ses articles
automatiquement. Un dev, Adrien, avait entraîné un très bon modèle (un CamemBERT
« fine-tuné », macro-F1 ≈ 0.87)… mais il est parti **sans laisser les poids du
modèle** (le fichier `pytorch_model.bin`, ~443 Mo). On a donc son *plan* (config,
tokenizer, notebook) mais **pas le cerveau entraîné**.

**Contraintes imposées par la CTO (Chloé)** :
- Un endpoint `POST /infer` qui prend `{"titre": "...", "texte": "..."}` et renvoie
  `{"categorie": "...", "score": 0.94, "latence_ms": 87}`.
- **Latence < 500 ms pour 99 % des requêtes** (p99 < 500 ms) — un « SLA ».
- Un endpoint `GET /health` qui dit si le modèle est chargé.
- Le tout doit tourner sous **Docker**, lançable en une seule commande.

**Le vrai défi** : produire un classifieur correct **sans réentraîner** de modèle
(pas le temps, pas les données complètes), tout en respectant le SLA de latence.

---

## 2. La décision centrale : le « zero-shot »

### 2.1 Pourquoi zero-shot ?

Sans les poids d'Adrien, deux options : réentraîner (trop long, données absentes)
ou utiliser un modèle **zero-shot**. On a choisi le zero-shot.

**Zero-shot classification** = classer un texte dans des catégories que le modèle
**n'a jamais apprises spécifiquement**. On lui donne le texte + la liste des
étiquettes possibles, et il évalue laquelle « colle » le mieux. Aucun
entraînement sur notre corpus n'est nécessaire.

Techniquement, ça repose sur du **NLI** (*Natural Language Inference*) : le modèle
sait juger si une phrase B découle d'une phrase A. On détourne cette capacité :
- A = l'article
- B = « Cet article parle de sport » (une hypothèse par catégorie)
- Le modèle donne un score à chaque hypothèse ; on garde la mieux notée.

### 2.2 Le modèle retenu : mDeBERTa-v3

On a choisi **`MoritzLaurer/mDeBERTa-v3-base-mnli-xnli`**. Justification :

| Critère | Détail |
|---|---|
| **Latence** | ~280M paramètres → tient le SLA : **p99 = 343 ms** (< 500 ms). |
| **Français natif** | entraîné sur XNLI (multilingue, français inclus), pas une traduction. |
| **Léger** | image Docker plus contenue qu'un gros modèle. |
| **Zero-shot prêt** | aucun fine-tuning, aucun corpus d'entraînement requis. |

> Note : la note d'Adrien suggérait `bart-large-mnli`. On a préféré mDeBERTa car
> il est plus rapide (SLA) et meilleur en français. On était **libres du choix**
> du modèle (le placeholder demandait juste « un modèle léger pour le zero-shot »).

### 2.3 Le réglage qui change tout : le gabarit d'hypothèse en français

Par défaut, la librairie construit l'hypothèse **en anglais** :
« This example is {} ». En la passant **en français** — « Cet article parle
de {} » — avec des étiquettes lisibles (« économie » plutôt que « economie »),
on gagne **+8 points de F1** (0.636 → 0.713). On l'a mesuré en comparant
3 configurations sur les 500 articles (voir `scripts/evaluate.py`).

---

## 3. Comment fonctionne l'inférence (le cœur)

Fichier : `app/inference.py`.

1. **Construction de l'entrée** (`build_input`) : on concatène `titre + ". " +
   texte`, puis on tronque à 1024 caractères (borne la latence). Concaténer titre
   et texte améliore la qualité (Adrien mesurait +3 pts de F1 ainsi).
2. **Chargement du modèle** (`load_model`) : le modèle est chargé **une seule
   fois** et gardé en cache (`lru_cache`). Il n'est jamais rechargé à chaque
   requête.
3. **Prédiction** (`predict`) :
   - on soumet le texte + les 5 étiquettes françaises + le gabarit FR ;
   - le modèle renvoie les scores triés ; on prend le meilleur ;
   - on **re-mappe** l'étiquette lisible (« économie ») vers l'étiquette
     canonique attendue par l'API (« economie ») ;
   - on mesure le temps écoulé (`latence_ms`).

Sortie : `{"categorie": "...", "score": 0.xx, "latence_ms": xx}`.

---

## 4. L'API (FastAPI)

Fichier : `app/main.py`.

- **`POST /infer`** : reçoit `{titre, texte}`, renvoie `{categorie, score,
  latence_ms}`. La validation est faite par **Pydantic** : si `texte` est vide ou
  absent, l'API répond automatiquement **HTTP 422** (erreur de validation).
- **`GET /health`** : renvoie `{"status": "ok", "model_loaded": true}`.
- **`GET /`** : métadonnées du service (liste des catégories, endpoints).

**Le « lifespan »** : le modèle est chargé **au démarrage du serveur** (pas à la
première requête). Ainsi :
- `/health` reflète le vrai état (chargé ou non) ;
- la première requête `/infer` n'est pas pénalisée par le temps de chargement.

---

## 5. Les résultats (mesurés)

### 5.1 Qualité — sur `articles_test.csv` (475 articles valides)

- **Accuracy : 0.731** · **Macro-F1 : 0.713**

| Classe | F1 |
|---|---|
| sport | 0.88 |
| culture | 0.83 |
| politique | 0.80 |
| faits_divers | 0.64 |
| economie | 0.41 |

`economie` est le point faible (souvent confondu avec politique/faits_divers),
comme le notait déjà Adrien. On reste ~15 pts sous son modèle fine-tuné (0.87) :
c'est le prix normal du zero-shot (aucun entraînement sur nos données).

### 5.2 Latence — 100 inférences à chaud, CPU

| p50 | p95 | p99 | SLA |
|---|---|---|---|
| 240 ms | 290 ms | **343 ms** | < 500 ms ✅ |

Chiffres reproductibles via `scripts/benchmark.py` (cf. §7.4). Les valeurs
varient légèrement selon la charge de la machine, mais restent sous le SLA.

---

## 6. Architecture du projet

```
inferloop-j1/
├── app/
│   ├── inference.py     # chargement du modèle + predict()
│   ├── main.py          # API FastAPI (/infer, /health, /) + sert /app/
│   └── static/
│       └── index.html   # frontend de test cliquable (UI)
├── scripts/
│   ├── evaluate.py      # validation + comparaison de configs sur les 500 articles
│   └── benchmark.py     # mesure la latence p50/p95/p99 (preuve du SLA)
├── tests/
│   └── test_api.py      # 8 tests pytest
├── presentation/
│   ├── index.html                 # deck web interactif (Swiss Grid)
│   └── MediaLens-InferLoop-J1.pptx
├── Dockerfile           # image CPU, modèle pré-téléchargé au build
├── docker-compose.yml   # lancement en une commande
├── requirements.txt     # dépendances figées
├── SOLUTION.md          # résumé de la livraison
└── docs/
    ├── note_adrien_modele.md
    └── GUIDE-COMPLET.md            # ce document
```

---

## 7. Lancer et tester l'API

> Toutes les commandes se lancent depuis la racine `inferloop-j1/`.

### 7.1 Lancer en local
```bash
.venv/bin/python -m uvicorn app.main:app --port 8000
```
Attendre `Application startup complete` (~10 s, chargement du modèle).

### 7.2 Tester — 4 façons

**A. Interface de test (le plus simple)** — ouvrir `http://127.0.0.1:8000/app/`.
Un frontend cliquable, servi par l'API elle-même : voyant de santé du modèle,
5 exemples pré-remplis (un par catégorie), et pour chaque classification la
catégorie, le score de confiance et la latence. Idéal pour une démo sans ligne
de commande.

**B. Swagger (interface web cliquable)** — ouvrir `http://127.0.0.1:8000/docs` :
1. Déplier `POST /infer` → **Try it out**.
2. Remplacer le corps par un vrai article :
   ```json
   {"titre": "Les Bleus en finale",
    "texte": "L'équipe de France s'est qualifiée après une victoire 2-1."}
   ```
3. **Execute** → la réponse s'affiche sous *Server response* (code 200 + JSON).

**C. En ligne de commande (curl)**
```bash
curl -X POST http://127.0.0.1:8000/infer -H "Content-Type: application/json" \
  -d '{"titre":"La Bourse monte","texte":"Le CAC 40 cloture en hausse porte par les banques."}'

curl http://127.0.0.1:8000/health
```

**D. Tests automatiques (pytest)**
```bash
.venv/bin/python -m pytest tests/ -v
```
→ 8 tests : santé, contrat de sortie, cas correct, erreurs 422, logique d'entrée.

### 7.3 Rejouer la validation qualité
```bash
.venv/bin/python -m scripts.evaluate
```
→ recalcule accuracy / macro-F1 / F1 par classe sur les 475 articles.

### 7.4 Mesurer la latence (preuve du SLA)
```bash
.venv/bin/python -m scripts.benchmark
```
→ charge le modèle, chronomètre 100 inférences à chaud et affiche p50/p95/p99
+ le verdict SLA (< 500 ms). C'est la source reproductible des chiffres de latence.

### 7.5 Avec Docker (comme en production)
```bash
docker compose up --build
```
Le modèle est téléchargé pendant le *build* → le conteneur démarre ensuite sans
réseau, `/health` passe `ok` en quelques secondes. Mêmes tests sur le port 8000.

---

## 8. La présentation (bonus)

Dans `presentation/` :
- **`index.html`** : deck web animé (9 slides, style Swiss Grid, 2 graphes
  interactifs). Navigation : ← →, espace, clic, molette, points. F11 = plein écran.
- **`MediaLens-InferLoop-J1.pptx`** : version PowerPoint éditable, générée par
  `build-deck.js` (texte modifiable, graphes retravaillés avec ligne de seuil SLA
  et point faible en rouge).

Régénérer le PowerPoint après une modif :
```bash
cd presentation && NODE_PATH=$(npm root -g) node build-deck.js
```

---

## 9. Limites connues et suites (Jour 2)

- **Écart au fine-tuné** : ~15 pts de F1 sous le modèle d'Adrien — inhérent au
  zero-shot. Regagnables avec les vrais poids ou un fine-tuning.
- **`economie` sous-détectée** (recall 0.31) : piste = étiquettes plus ciblées ou
  du *few-shot* (donner quelques exemples au modèle).
- **Articles courts** (< 50 mots) moins fiables (déjà signalé par Adrien).
- **Pas de monitoring de drift** : on ne détecte pas encore une dégradation sur
  des articles récents.
- **Image Docker** relativement lourde (torch + modèle) — atténuée par le wheel
  CPU-only et le `.dockerignore`.

---

## 10. Glossaire (pour expliquer les termes)

- **Fine-tuning** : réentraîner un modèle existant sur un jeu de données précis
  pour le spécialiser. Le modèle d'Adrien était fine-tuné ; le nôtre non.
- **Zero-shot** : classer sans avoir appris les catégories au préalable.
- **NLI (Natural Language Inference)** : tâche où le modèle juge si une phrase
  découle d'une autre. Base technique du zero-shot ici.
- **CamemBERT / mDeBERTa** : des modèles de langage (type BERT) ; mDeBERTa est
  multilingue et sait le français nativement.
- **Tokenizer** : découpe le texte en unités (tokens) que le modèle comprend.
- **Gabarit d'hypothèse (hypothesis template)** : la phrase modèle utilisée pour
  transformer une étiquette en hypothèse (« Cet article parle de {} »).
- **F1 / macro-F1** : mesure de qualité combinant précision et rappel. « Macro »
  = moyenne des F1 par classe (chaque classe compte pareil).
- **Precision / Recall** : précision = parmi les prédits « sport », combien le sont
  vraiment ; rappel = parmi les vrais « sport », combien ont été trouvés.
- **Accuracy** : proportion de prédictions correctes, toutes classes confondues.
- **Latence / p50 / p95 / p99** : on trie toutes les mesures de latence, de la plus
  rapide à la plus lente. **p50** (la médiane) = le cas typique, la moitié des
  requêtes sont plus rapides. **p95** = seules 5 % des requêtes dépassent cette
  valeur. **p99** = quasi le pire cas, seule 1 requête sur 100 dépasse. On vise le
  p99 pour le SLA (et non la moyenne, qui masque les pics) afin de garantir la
  rapidité même dans les cas les plus lents.
- **SLA (Service Level Agreement)** : engagement de niveau de service ; ici
  « p99 < 500 ms ».
- **Endpoint** : une URL de l'API qui rend un service (`/infer`, `/health`).
- **Pydantic** : librairie qui valide automatiquement le format des données
  entrantes (et renvoie 422 si invalide).
- **Lifespan** : mécanisme FastAPI pour exécuter du code au démarrage/arrêt du
  serveur (ici : charger le modèle une fois).
- **Docker / image / conteneur** : Docker empaquette l'app + ses dépendances dans
  une « image » ; un « conteneur » est une instance de cette image qui tourne.
- **CPU-only (torch)** : version de PyTorch sans les librairies GPU (CUDA), plus
  légère, suffisante ici.
