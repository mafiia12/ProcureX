"""Fail without writing when DATABASE_URL is not at the single Alembic head."""

from __future__ import annotations

import os
from pathlib import Path

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine


BACKEND_DIR = Path(__file__).resolve().parents[1]


def normalize_url(url: str) -> str:
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def main() -> int:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()
    if len(heads) != 1:
        raise SystemExit(f"Expected one Alembic head, found: {heads}")
    engine = create_engine(normalize_url(database_url), pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            current = MigrationContext.configure(connection).get_current_revision()
    finally:
        engine.dispose()
    if current != heads[0]:
        raise SystemExit(f"Database schema is {current or 'unversioned'}; expected {heads[0]}")
    print(f"Database schema is current at {current}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
