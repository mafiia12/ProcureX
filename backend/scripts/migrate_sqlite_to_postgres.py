"""Copy ProcureX data from SQLite to an empty, migrated PostgreSQL database.

The command is read-only unless --execute is supplied. Execution creates a
transactionally consistent SQLite backup first and rolls PostgreSQL back if any
record count or financial total differs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from sqlalchemy import JSON, create_engine, func, inspect, select

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from database import Base  # noqa: E402
import incoming_requests  # noqa: E402,F401
import price_comparisons  # noqa: E402,F401


TABLE_ORDER = [
    "business_code_sequences", "price_comparisons", "price_comparison_rows",
    "suppliers", "customers", "projects", "items", "purchases", "purchase_items",
    "payments", "price_history", "settings", "incoming_purchase_requests",
    "incoming_purchase_request_items", "incoming_request_attachments",
    "incoming_request_status_history", "incoming_request_internal_notes",
    "internal_notifications", "internal_purchase_documents",
    "internal_purchase_document_items",
]
TOTALS = {
    "purchases": [
        "shipping_cost", "other_costs", "subtotal", "discount_total",
        "after_discount", "vat_total", "invoice_total",
    ],
    "purchase_items": ["quantity", "unit_price", "line_total"],
    "payments": ["amount_paid"],
    "price_history": ["quantity", "unit_price", "final_price"],
}


def normalize_postgres_url(url: str) -> str:
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def sqlite_connection(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{path.resolve().as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def snapshot_sqlite(connection: sqlite3.Connection) -> dict:
    existing = {row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    counts = {}
    totals = {}
    for table_name in TABLE_ORDER:
        counts[table_name] = (
            connection.execute(f'SELECT COUNT(*) FROM "{table_name}"').fetchone()[0]
            if table_name in existing else 0
        )
    for table_name, columns in TOTALS.items():
        if table_name not in existing:
            continue
        totals[table_name] = {
            column: str(Decimal(str(connection.execute(
                f'SELECT COALESCE(SUM("{column}"), 0) FROM "{table_name}"'
            ).fetchone()[0] or 0)).quantize(Decimal("0.000001")))
            for column in columns
        }
    return {"counts": counts, "totals": totals}


def snapshot_postgres(connection) -> dict:
    counts = {}
    totals = {}
    for table_name in TABLE_ORDER:
        table = Base.metadata.tables[table_name]
        counts[table_name] = connection.scalar(select(func.count()).select_from(table))
    for table_name, columns in TOTALS.items():
        table = Base.metadata.tables[table_name]
        totals[table_name] = {
            column: str(Decimal(str(connection.scalar(
                select(func.coalesce(func.sum(table.c[column]), 0))
            ) or 0)).quantize(Decimal("0.000001")))
            for column in columns
        }
    return {"counts": counts, "totals": totals}


def verify(source: dict, target: dict) -> None:
    if source["counts"] != target["counts"]:
        raise RuntimeError(f"Record-count mismatch: source={source['counts']} target={target['counts']}")
    for table_name, values in source["totals"].items():
        for column, source_value in values.items():
            delta = abs(Decimal(source_value) - Decimal(target["totals"][table_name][column]))
            if delta > Decimal("0.0001"):
                raise RuntimeError(f"Total mismatch for {table_name}.{column}: {delta}")


def create_sqlite_backup(source: Path, backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = backup_dir.resolve() / f"procurement-pre-postgres-{stamp}.db"
    if target.exists():
        raise RuntimeError(f"Refusing to overwrite backup: {target}")
    source_connection = sqlite_connection(source)
    try:
        with sqlite3.connect(target) as target_connection:
            source_connection.backup(target_connection)
    finally:
        source_connection.close()
    with sqlite3.connect(target) as check:
        if check.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Backup integrity check failed")
    return target


def decode_row(table, row: sqlite3.Row) -> dict:
    source = dict(row)
    result = {}
    for column in table.columns:
        value = source.get(column.name)
        if value is not None and isinstance(column.type, JSON) and isinstance(value, str):
            value = json.loads(value)
        result[column.name] = value
    return result


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite", type=Path, default=BACKEND_DIR / "procurement.db")
    parser.add_argument("--target-url", default=os.getenv("TARGET_DATABASE_URL") or os.getenv("DATABASE_URL"))
    parser.add_argument("--backup-dir", type=Path, default=BACKEND_DIR / "backups")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()

    if not args.sqlite.is_file():
        raise SystemExit(f"SQLite source not found: {args.sqlite}")
    with sqlite_connection(args.sqlite) as source_connection:
        integrity = source_connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise SystemExit(f"SQLite integrity check failed: {integrity}")
        foreign_key_violations = [tuple(row) for row in source_connection.execute(
            "PRAGMA foreign_key_check"
        ).fetchall()]
        if foreign_key_violations:
            raise SystemExit(f"SQLite foreign-key violations: {foreign_key_violations}")
        source_snapshot = snapshot_sqlite(source_connection)

    report = {
        "mode": "execute" if args.execute else "dry-run",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": str(args.sqlite.resolve()),
        "source_sha256": sha256(args.sqlite),
        "sqlite_integrity": "ok",
        "sqlite_foreign_key_violations": 0,
        "source_snapshot": source_snapshot,
    }
    if not args.execute:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    if not args.target_url:
        raise SystemExit("--target-url or TARGET_DATABASE_URL is required with --execute")
    target_url = normalize_postgres_url(args.target_url)
    if not target_url.startswith("postgresql+psycopg://"):
        raise SystemExit("The migration target must be PostgreSQL")

    backup_path = create_sqlite_backup(args.sqlite, args.backup_dir)
    report["backup"] = str(backup_path)
    report["backup_sha256"] = sha256(backup_path)
    target_engine = create_engine(target_url, pool_pre_ping=True)
    required = set(TABLE_ORDER)
    existing = set(inspect(target_engine).get_table_names())
    if not required.issubset(existing):
        raise SystemExit("Target schema is incomplete; run 'alembic upgrade head' first")

    with target_engine.begin() as target_connection:
        target_before = snapshot_postgres(target_connection)
        if any(target_before["counts"].values()):
            raise RuntimeError("Target tables must be empty; migration aborted without changes")
        with sqlite_connection(args.sqlite) as source_connection:
            source_tables = {row[0] for row in source_connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )}
            for table_name in TABLE_ORDER:
                if table_name not in source_tables:
                    continue
                table = Base.metadata.tables[table_name]
                rows = source_connection.execute(f'SELECT * FROM "{table_name}"').fetchall()
                if rows:
                    target_connection.execute(table.insert(), [decode_row(table, row) for row in rows])
        target_after = snapshot_postgres(target_connection)
        verify(source_snapshot, target_after)
        report["target_snapshot"] = target_after
        report["verified"] = True

    serialized = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.write_text(serialized + "\n", encoding="utf-8")
    print(serialized)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
