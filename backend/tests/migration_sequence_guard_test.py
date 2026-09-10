"""Focused regression guard for migrate_sqlite_to_postgres.py's sequence-sync
assumption: the script has no PostgreSQL setval() logic anywhere, which is
only safe because every primary key in this schema is an application-
generated string, never a PostgreSQL SERIAL/IDENTITY column.

The detection logic itself (schema_guards.autoincrement_primary_keys) is
tested directly against synthetic metadata - it has no model imports, so
this never touches the real Base.metadata. Whether it also holds for the
REAL, current schema is checked by running the actual script as a
subprocess rather than importing it in-process: importing
migrate_sqlite_to_postgres.py pulls in every model module, including
construction_calculator.models, which would permanently register those
tables on the shared SQLAlchemy Base for the rest of this pytest session -
exactly what backend_test.py's construction_calculator tests assert never
happens on a normal startup.
"""

from __future__ import annotations

import subprocess
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = BACKEND_DIR / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from schema_guards import autoincrement_primary_keys  # noqa: E402
from sqlalchemy import Column, Integer, MetaData, String, Table  # noqa: E402


def test_detector_catches_an_autoincrement_integer_primary_key():
    metadata = MetaData()
    Table("fake_table", metadata, Column("id", Integer, primary_key=True))
    assert autoincrement_primary_keys(metadata) == [("fake_table", "id")]


def test_detector_ignores_an_explicit_non_autoincrement_integer_key():
    metadata = MetaData()
    Table(
        "fake_table", metadata,
        Column("id", Integer, primary_key=True, autoincrement=False),
    )
    assert autoincrement_primary_keys(metadata) == []


def test_detector_ignores_string_primary_keys():
    metadata = MetaData()
    Table("fake_table", metadata, Column("id", String, primary_key=True))
    assert autoincrement_primary_keys(metadata) == []


def test_detector_ignores_composite_integer_primary_keys():
    """A composite key is never SQLAlchemy's single-column autoincrement
    case - out of scope for this guard, not a false negative."""
    metadata = MetaData()
    Table(
        "fake_table", metadata,
        Column("a", Integer, primary_key=True),
        Column("b", Integer, primary_key=True),
    )
    assert autoincrement_primary_keys(metadata) == []


def test_migration_script_accepts_the_current_real_schema(tmp_path):
    """Runs the real script (dry-run, read-only) in its own process and
    confirms it does not abort - on the autoincrement-primary-key guard or
    any other startup check - against today's actual, complete schema."""
    script = SCRIPTS_DIR / "migrate_sqlite_to_postgres.py"
    source = tmp_path / "migrated-source.db"
    environment = os.environ.copy()
    environment["DATABASE_URL"] = f"sqlite:///{source.as_posix()}"
    environment.pop("TARGET_DATABASE_URL", None)
    upgrade = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
        cwd=BACKEND_DIR, env=environment, capture_output=True, text=True, timeout=60,
    )
    assert upgrade.returncode == 0, upgrade.stderr
    result = subprocess.run(
        [sys.executable, str(script), "--sqlite", str(source)],
        cwd=BACKEND_DIR, env=environment, capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stderr
