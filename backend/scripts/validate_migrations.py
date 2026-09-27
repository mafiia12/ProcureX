"""Upgrade a disposable SQLite database to validate the complete Alembic chain."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


BACKEND_DIR = Path(__file__).resolve().parents[1]
FORBIDDEN_SCHEMA_OPERATIONS = ("op.drop_", "DROP TABLE", "TRUNCATE TABLE", "DELETE FROM")
HISTORICAL_MIGRATION_AUDIT_FINDING = "acknowledged/waived"
ACKNOWLEDGED_HISTORICAL_REVISIONS = {
    # This applied revision predates the additive-only audit gate. Pinning its
    # exact contents preserves migration immutability without weakening checks
    # for any other existing or newly introduced revision.
    "0007_purchase_request_item_review.py": (
        "f279973f809707a9e6973b3469492a5b4af9b644c7958c060258678cfaf45e99"
    ),
}


def main() -> int:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()
    if len(heads) != 1:
        raise SystemExit(f"Expected one Alembic head, found: {heads}")
    unsafe = []
    for migration in sorted((BACKEND_DIR / "alembic" / "versions").glob("*.py")):
        acknowledged_digest = ACKNOWLEDGED_HISTORICAL_REVISIONS.get(migration.name)
        if acknowledged_digest is not None:
            actual_digest = hashlib.sha256(migration.read_bytes()).hexdigest()
            if actual_digest != acknowledged_digest:
                raise SystemExit(
                    "Historical applied migration was modified: "
                    f"{migration.name}"
                )
            continue
        content = migration.read_text(encoding="utf-8")
        for operation in FORBIDDEN_SCHEMA_OPERATIONS:
            if operation.lower() in content.lower():
                unsafe.append(f"{migration.name}: {operation}")
    if unsafe:
        raise SystemExit(f"Destructive migration operations are forbidden: {unsafe}")

    with tempfile.TemporaryDirectory(prefix="procurex-alembic-") as temporary:
        database = Path(temporary) / "migration-validation.db"
        database_url = f"sqlite:///{database.as_posix()}"
        migration_environment = os.environ.copy()
        migration_environment["DATABASE_URL"] = database_url
        subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
            cwd=BACKEND_DIR,
            env=migration_environment,
            check=True,
        )

        connection = sqlite3.connect(database)
        try:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            violations = connection.execute("PRAGMA foreign_key_check").fetchall()
            current = connection.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            table_count = connection.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
            ).fetchone()[0]
        finally:
            connection.close()
        if integrity != "ok" or violations or current != heads[0]:
            raise SystemExit(
                f"Migration validation failed: integrity={integrity}, "
                f"foreign_keys={violations}, current={current}, head={heads[0]}"
            )
        subprocess.run(
            [sys.executable, str(BACKEND_DIR / "scripts" / "assert_schema_current.py")],
            cwd=BACKEND_DIR,
            env=migration_environment,
            check=True,
        )
        print(json.dumps({
            "alembic_head": heads[0],
            "integrity": integrity,
            "foreign_key_violations": 0,
            "additive_policy": "passed",
            "historical_migration_audit_finding": HISTORICAL_MIGRATION_AUDIT_FINDING,
            "table_count": table_count,
        }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
