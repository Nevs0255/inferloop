# MédiaLens — API de classification d'articles (mDeBERTa zero-shot)
FROM python:3.12-slim

# Réglages Python (pas de .pyc, logs non bufferisés) + cache HF dans l'image.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/opt/hf-cache \
    TRANSFORMERS_OFFLINE=0

WORKDIR /app

# 1) torch en version CPU-only (évite d'embarquer les libs CUDA -> image légère).
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
    torch==2.14.0

# 2) le reste des dépendances (torch déjà satisfait, non réinstallé).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 3) Pré-téléchargement du modèle au build : le conteneur démarre sans réseau
#    et /health passe "ok" en quelques secondes.
RUN python -c "from transformers import pipeline; \
pipeline('zero-shot-classification', model='MoritzLaurer/mDeBERTa-v3-base-mnli-xnli')"

# 4) Code applicatif.
COPY app ./app

EXPOSE 8000

# Healthcheck branché sur l'endpoint /health de l'API.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
