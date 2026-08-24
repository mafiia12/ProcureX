"""Safely adopt a compatible, unversioned ProcureX SQLite database into Alembic.

Historical migrations are executed only against a new temporary database.  The
candidate is stamped only after its semantic schema matches that fresh database,
an online SQLite backup succeeds, and business-row fingerprints are captured.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from alembic.config import Config
from alembic.script import ScriptDirectory

try:
    from .schema_fingerprint import semantic_schema
except ImportError:  # Direct script execution.
    from schema_fingerprint import semantic_schema


BACKEND_DIR = Path(__file__).resolve().parents[1]


def _quote(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _json_value(value: Any) -> Any:
    if isinstance(value, bytes):
        return {"bytes_hex": value.hex()}
    return value


def _sha256_json(value: Any) -> str:
    rendered = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(rendered.encode("utf-8")).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _table_names(connection: sqlite3.Connection) -> list[str]:
    return [
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' AND name <> 'alembic_version' "
            "ORDER BY name"
        )
    ]


def _row_digest(connection: sqlite3.Connection, table: str) -> str:
    columns_info = list(connection.execute(f"PRAGMA table_info({_quote(table)})"))
    columns = [row[1] for row in columns_info]
    primary_key = [
        row[1] for row in sorted(columns_info, key=lambda item: item[5]) if row[5]
    ]
    order = primary_key or columns
    select_columns = ", ".join(_quote(column) for column in columns)
    order_columns = ", ".join(_quote(column) for column in order)
    digest = hashlib.sha256()
    for row in connection.execute(
        f"SELECT {select_columns} FROM {_quote(table)} ORDER BY {order_columns}"
    ):
        rendered = json.dumps(
            [_json_value(value) for value in row],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        digest.update(rendered.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def inspect_database(path: Path) -> dict[str, Any]:
    resolved = path.resolve()
    if not resolved.is_file() or resolved.stat().st_size == 0:
        raise RuntimeError(f"A non-empty SQLite database is required: {resolved}")
    connection = sqlite3.connect(f"file:{resolved.as_posix()}?mode=ro", uri=True)
    try:
        connection.execute("PRAGMA query_only=ON")
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        all_tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        revision_rows = (
            [row[0] for row in connection.execute(
                "SELECT version_num FROM alembic_version"
            )]
            if "alembic_version" in all_tables
            else []
        )
        tables = _table_names(connection)
        counts = {
            table: connection.execute(
                f"SELECT COUNT(*) FROM {_quote(table)}"
            ).fetchone()[0]
            for table in tables
        }
        row_digests = {
            table: _row_digest(connection, table)
            for table in tables
        }
        totals_queries = {
            "purchase_invoice_total": (
                "purchases", "SELECT COALESCE(SUM(invoice_total), 0) FROM purchases"
            ),
            "purchase_line_total": (
                "purchase_items",
                "SELECT COALESCE(SUM(line_total), 0) FROM purchase_items",
            ),
            "payments_total": (
                "payments", "SELECT COALESCE(SUM(amount_paid), 0) FROM payments"
            ),
        }
        totals = {
            key: connection.execute(statement).fetchone()[0]
            for key, (table, statement) in totals_queries.items()
            if table in tables
        }
        if "purchase_invoice_total" in totals and "payments_total" in totals:
            totals["outstanding_total"] = (
                totals["purchase_invoice_total"] - totals["payments_total"]
            )
        semantic = semantic_schema(connection)
    finally:
        connection.close()
    return {
        "path": str(resolved),
        "integrity": integrity,
        "foreign_key_violations": len(violations),
        "alembic_table_present": "alembic_version" in all_tables,
        "alembic_revisions": revision_rows,
        "counts": counts,
        "financial_totals": totals,
        "row_digests": row_digests,
        "semantic_sha256": _sha256_json(semantic),
        "semantic": semantic,
    }


def alembic_head() -> str:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    heads = ScriptDirectory.from_config(config).get_heads()
    if len(heads) != 1:
        raise RuntimeError(f"Expected one Alembic head, found: {heads}")
    return heads[0]


def create_fresh_reference(path: Path) -> None:
    environment = os.environ.copy()
    environment["DATABASE_URL"] = f"sqlite:///{path.resolve().as_posix()}"
    subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env=environment,
        check=True,
    )


def _semantic_differences(reference: dict, candidate: dict) -> list[str]:
    reference_tables = reference["semantic"]["tables"]
    candidate_tables = candidate["semantic"]["tables"]
    return [
        table
        for table in sorted(set(reference_tables) | set(candidate_tables))
        if reference_tables.get(table) != candidate_tables.get(table)
    ]


def _online_backup(source_path: Path, backup_path: Path) -> None:
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    if backup_path.exists():
        raise RuntimeError(f"Refusing to overwrite adoption backup: {backup_path}")
    source = sqlite3.connect(
        f"file:{source_path.resolve().as_posix()}?mode=ro", uri=True
    )
    destination = sqlite3.connect(backup_path)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    verified = inspect_database(backup_path)
    if verified["integrity"] != "ok" or verified["foreign_key_violations"]:
        raise RuntimeError("Adoption safety backup verification failed")


def adopt_database(
    database: Path,
    backup_dir: Path,
    report_path: Path | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    database = database.resolve()
    expected_revision = alembic_head()
    before = inspect_database(database)
    if before["integrity"] != "ok" or before["foreign_key_violations"]:
        raise RuntimeError("Candidate integrity or foreign-key validation failed")
    if before["alembic_table_present"]:
        raise RuntimeError(
            "Candidate already contains alembic_version; adoption is only for "
            "strictly unversioned databases"
        )

    with tempfile.TemporaryDirectory(prefix="procurex-adoption-reference-") as temporary:
        reference_path = Path(temporary) / "fresh-head.db"
        create_fresh_reference(reference_path)
        reference = inspect_database(reference_path)
        if reference["alembic_revisions"] != [expected_revision]:
            raise RuntimeError("Fresh Alembic reference did not reach the expected head")
        different_tables = _semantic_differences(reference, before)
        if different_tables:
            raise RuntimeError(
                "Semantic schema mismatch; refusing adoption. Different tables: "
                + ", ".join(different_tables)
            )

    report: dict[str, Any] = {
        "database": str(database),
        "expected_revision": expected_revision,
        "semantic_validation": "matched_fresh_head",
        "different_tables": [],
        "dry_run": dry_run,
        "before": {key: value for key, value in before.items() if key != "semantic"},
    }
    if dry_run:
        report["status"] = "validated_not_adopted"
    else:
        backup_path = backup_dir.resolve() / (
            f"{database.stem}.pre-alembic-adoption{database.suffix}"
        )
        _online_backup(database, backup_path)
        report["backup"] = str(backup_path)
        report["backup_sha256"] = _sha256_file(backup_path)

        connection = sqlite3.connect(database)
        try:
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("BEGIN IMMEDIATE")
            current_semantic = _sha256_json(semantic_schema(connection))
            if current_semantic != before["semantic_sha256"]:
                raise RuntimeError("Candidate schema changed during adoption")
            table_exists = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' "
                "AND name='alembic_version'"
            ).fetchone()
            if table_exists:
                raise RuntimeError("alembic_version appeared during adoption")
            connection.execute(
                "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"
            )
            connection.execute(
                "INSERT INTO alembic_version (version_num) VALUES (?)",
                (expected_revision,),
            )
            violations = connection.execute("PRAGMA foreign_key_check").fetchall()
            if violations:
                raise RuntimeError(f"Foreign-key violations after adoption: {violations}")
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

        after = inspect_database(database)
        for field in ("counts", "financial_totals", "row_digests", "semantic_sha256"):
            if after[field] != before[field]:
                raise RuntimeError(f"Business data changed during adoption: {field}")
        if after["alembic_revisions"] != [expected_revision]:
            raise RuntimeError("Adopted revision was not recorded correctly")
        report["after"] = {
            key: value for key, value in after.items() if key != "semantic"
        }
        report["recorded_revision"] = expected_revision
        report["status"] = "adopted"

    rendered = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
    if report_path:
        report_path = report_path.resolve()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(rendered + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    parser.add_argument("--backup-dir", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        report = adopt_database(
            args.database,
            args.backup_dir,
            report_path=args.report,
            dry_run=args.dry_run,
        )
    except (RuntimeError, sqlite3.DatabaseError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
