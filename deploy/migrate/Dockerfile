FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/procurex/backend
COPY backend/requirements.txt backend/requirements-production.txt ./
RUN pip install --no-cache-dir -r requirements-production.txt
COPY backend/ ./

ENTRYPOINT ["python", "scripts/verified_production_migration.py"]
