"""Release-schema gate used by the bundled ProcureX desktop runtime.

The desktop package does not replay historical migrations against an existing
customer database. Every supported unversioned shape is semantically verified
and backed up before narrowly scoped reconciliation or Alembic adoption.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from schema_contract import HEAD_REVISION, reconcile_sqlite_connection
from scripts.schema_fingerprint import release_semantic_schema, semantic_schema


EXPECTED_SEMANTIC_SHA256 = (
    "a6592d200824de1ba1d348683bd1b583d356ab5ba7a3cc3d27c83c7d63019288"
)
CORRECTED_ANCESTRY_LEGACY_SEMANTIC_SHA256 = {
    # Certified 0016 schema and the unversioned local ProcureX database shape
    # shipped immediately before the additive corrected-request ancestry fields.
    "1696c8f6002fdca7445b5734f90a4e35101dd271ea1d578e266e0606651d6082",
    "6ce55002652092793f4b58ae2e1fbe19c09c1eb55231a645cebcdc61e8d2b9ad",
}
PRESERVED_FIELDS = ("counts", "financial_totals")


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
    selected = ", ".join(_quote(column) for column in columns)
    ordered = ", ".join(_quote(column) for column in order)
    digest = hashlib.sha256()
    for row in connection.execute(
        f"SELECT {selected} FROM {_quote(table)} ORDER BY {ordered}"
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


def _inspect_connection(connection: sqlite3.Connection) -> dict[str, Any]:
    integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
    violations = connection.execute("PRAGMA foreign_key_check").fetchall()
    all_tables = {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    revisions = (
        [row[0] for row in connection.execute("SELECT version_num FROM alembic_version")]
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
    row_digests = {table: _row_digest(connection, table) for table in tables}
    total_queries = {
        "purchase_invoice_total": (
            "purchases",
            "SELECT COALESCE(SUM(invoice_total), 0) FROM purchases",
        ),
        "purchase_line_total": (
            "purchase_items",
            "SELECT COALESCE(SUM(line_total), 0) FROM purchase_items",
        ),
        "payments_total": (
            "payments",
            "SELECT COALESCE(SUM(amount_paid), 0) FROM payments",
        ),
    }
    totals = {
        key: connection.execute(statement).fetchone()[0]
        for key, (table, statement) in total_queries.items()
        if table in tables
    }
    if "purchase_invoice_total" in totals and "payments_total" in totals:
        totals["outstanding_total"] = (
            totals["purchase_invoice_total"] - totals["payments_total"]
        )
    semantic = semantic_schema(connection)
    release_semantic = release_semantic_schema(connection)
    return {
        "integrity": integrity,
        "foreign_key_violations": len(violations),
        "alembic_table_present": "alembic_version" in all_tables,
        "alembic_revisions": revisions,
        "counts": counts,
        "financial_totals": totals,
        "row_digests": row_digests,
        "semantic_sha256": _sha256_json(release_semantic),
        "strict_semantic_sha256": _sha256_json(semantic),
    }


def inspect_release_database(path: Path) -> dict[str, Any]:
    resolved = path.resolve()
    if not resolved.is_file() or resolved.stat().st_size == 0:
        raise RuntimeError(f"A non-empty SQLite database is required: {resolved}")
    with closing(
        sqlite3.connect(f"file:{resolved.as_posix()}?mode=ro", uri=True)
    ) as connection:
        connection.execute("PRAGMA query_only=ON")
        return {"path": str(resolved), **_inspect_connection(connection)}


def _assert_healthy(state: dict[str, Any]) -> None:
    if state["integrity"] != "ok" or state["foreign_key_violations"]:
        raise RuntimeError(
            "ProcureX database failed integrity or foreign-key validation"
        )


def _assert_preserved(before: dict[str, Any], after: dict[str, Any]) -> None:
    for field in PRESERVED_FIELDS:
        if before[field] != after[field]:
            raise RuntimeError(f"Business data changed during schema adoption: {field}")

    if before["row_digests"] == after["row_digests"]:
        return

    # Adding nullable ancestry columns changes the whole-row digest for populated
    # incoming requests even though every pre-existing value remains untouched.
    # Accept that one exact, certified additive transition only; any other table
    # digest difference still aborts the adoption.
    changed_tables = {
        table
        for table in set(before["row_digests"]) | set(after["row_digests"])
        if before["row_digests"].get(table) != after["row_digests"].get(table)
    }
    ancestry_only_transition = (
        before.get("strict_semantic_sha256", before["semantic_sha256"])
        in CORRECTED_ANCESTRY_LEGACY_SEMANTIC_SHA256
        and after["semantic_sha256"] == EXPECTED_SEMANTIC_SHA256
        and changed_tables == {"incoming_purchase_requests"}
        and before["counts"].get("incoming_purchase_requests", 0)
        == after["counts"].get("incoming_purchase_requests", 0)
    )
    if not ancestry_only_transition:
        raise RuntimeError("Business data changed during schema adoption: row_digests")


def _backup_database(source: Path, backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    candidate = backup_dir / f"{source.stem}.pre-runtime-adoption-{stamp}.db"
    sequence = 1
    while candidate.exists():
        candidate = backup_dir / (
            f"{source.stem}.pre-runtime-adoption-{stamp}-{sequence}.db"
        )
        sequence += 1
    with closing(
        sqlite3.connect(f"file:{source.resolve().as_posix()}?mode=ro", uri=True)
    ) as source_connection:
        with closing(sqlite3.connect(candidate)) as destination_connection:
            source_connection.backup(destination_connection)
    backup_state = inspect_release_database(candidate)
    _assert_healthy(backup_state)
    return candidate


def _create_fresh_database(database: Path) -> dict[str, Any]:
    """Create the complete certified application schema for a new database."""
    from sqlalchemy import create_engine

    from database import Base
    import auth.models  # noqa: F401 - registers authentication tables
    import construction_calculator.models  # noqa: F401 - schema compatibility only
    import daily_report  # noqa: F401 - registers daily-report tables
    import document_capture.models  # noqa: F401 - registers document tables
    import incoming_requests  # noqa: F401 - registers request tables
    import price_comparisons  # noqa: F401 - registers comparison tables
    import procurement_workflow  # noqa: F401 - registers approval/workflow tables
    import rfq  # noqa: F401 - registers RFQ tables
    import whatsapp.models  # noqa: F401 - registers WhatsApp tables

    database.parent.mkdir(parents=True, exist_ok=True)
    temporary = database.parent / f".{database.name}.initialize-{uuid.uuid4().hex}.tmp"
    engine = create_engine(
        f"sqlite:///{temporary.as_posix()}", connect_args={"check_same_thread": False}
    )
    try:
        Base.metadata.create_all(engine)
    finally:
        engine.dispose()
    try:
        before = inspect_release_database(temporary)
        _assert_healthy(before)
        if before["semantic_sha256"] != EXPECTED_SEMANTIC_SHA256:
            raise RuntimeError(
                "Fresh ProcureX schema does not match the certified release baseline"
            )
        _stamp_exact_schema(temporary, before)
        after = inspect_release_database(temporary)
        _assert_preserved(before, after)
        os.replace(temporary, database)
    finally:
        temporary.unlink(missing_ok=True)
    final = inspect_release_database(database)
    return {"status": "initialized", "database": str(database), "after": final}


def _stamp_exact_schema(database: Path, before: dict[str, Any]) -> None:
    with closing(sqlite3.connect(database)) as connection:
        try:
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("BEGIN IMMEDIATE")
            current = _inspect_connection(connection)
            if current["semantic_sha256"] != before["semantic_sha256"]:
                raise RuntimeError("ProcureX database schema changed during adoption")
            _assert_preserved(before, current)
            if current["alembic_table_present"]:
                raise RuntimeError("alembic_version appeared during adoption")
            connection.execute(
                "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"
            )
            connection.execute(
                "INSERT INTO alembic_version (version_num) VALUES (?)",
                (HEAD_REVISION,),
            )
            if connection.execute("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("Foreign-key validation failed after adoption")
            connection.commit()
        except Exception:
            connection.rollback()
            raise


def _reconcile_and_stamp(database: Path, before: dict[str, Any]) -> dict[str, Any]:
    with closing(sqlite3.connect(database)) as connection:
        try:
            connection.execute("PRAGMA foreign_keys=OFF")
            connection.execute("BEGIN IMMEDIATE")
            current = _inspect_connection(connection)
            if current["semantic_sha256"] != before["semantic_sha256"]:
                raise RuntimeError("Legacy ProcureX database changed during validation")
            _assert_preserved(before, current)
            changes = reconcile_sqlite_connection(connection)
            reconciled = _inspect_connection(connection)
            if reconciled["semantic_sha256"] != EXPECTED_SEMANTIC_SHA256:
                raise RuntimeError(
                    "Legacy ProcureX reconciliation did not reach the certified schema"
                )
            _assert_preserved(before, reconciled)
            connection.execute(
                "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"
            )
            connection.execute(
                "INSERT INTO alembic_version (version_num) VALUES (?)",
                (HEAD_REVISION,),
            )
            if connection.execute("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("Foreign-key validation failed after reconciliation")
            connection.commit()
            return changes
        except Exception:
            connection.rollback()
            raise


def _reconcile_versioned_previous_release(database: Path, before: dict[str, Any]) -> dict[str, Any]:
    """Apply the certified additive 0016 -> 0017 reconciliation in place."""
    with closing(sqlite3.connect(database)) as connection:
        try:
            connection.execute("PRAGMA foreign_keys=OFF")
            connection.execute("BEGIN IMMEDIATE")
            current = _inspect_connection(connection)
            if current["semantic_sha256"] != before["semantic_sha256"]:
                raise RuntimeError("ProcureX database changed during versioned reconciliation")
            _assert_preserved(before, current)
            changes = reconcile_sqlite_connection(connection)
            reconciled = _inspect_connection(connection)
            if reconciled["semantic_sha256"] != EXPECTED_SEMANTIC_SHA256:
                raise RuntimeError("Versioned reconciliation did not reach the certified schema")
            _assert_preserved(before, reconciled)
            connection.execute(
                "UPDATE alembic_version SET version_num = ?", (HEAD_REVISION,),
            )
            if connection.execute("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("Foreign-key validation failed after versioned reconciliation")
            connection.commit()
            return changes
        except Exception:
            connection.rollback()
            raise
