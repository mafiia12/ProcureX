"""Safely reconcile a ProcureX SQLite clone or explicitly approved database."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from schema_contract import reconcile_sqlite_connection  # noqa: E402


def _tables(connection: sqlite3.Connection) -> list[str]:
    return [
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]


def _counts(connection: sqlite3.Connection) -> dict[str, int]:
    return {
        table: connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        for table in _tables(connection)
    }


def _row_digests(connection: sqlite3.Connection) -> dict[str, str]:
    result = {}
    for table in _tables(connection):
        if table == "alembic_version":
            continue
        columns = [row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')]
        digest = hashlib.sha256()
        select_columns = ", ".join(f'quote("{column}")' for column in columns)
        order = ", ".join(f'"{column}"' for column in columns)
        for row in connection.execute(
            f'SELECT {select_columns} FROM "{table}" ORDER BY {order}'
        ):
            digest.update(json.dumps(row, ensure_ascii=False).encode("utf-8"))
            digest.update(b"\n")
        result[table] = digest.hexdigest()
    return result


def _financial_totals(connection: sqlite3.Connection) -> dict[str, float]:
    tables = set(_tables(connection))
    queries = {
        "purchase_invoice_total": "SELECT COALESCE(SUM(invoice_total), 0) FROM purchases",
        "purchase_line_total": "SELECT COALESCE(SUM(line_total), 0) FROM purchase_items",
        "payments_total": "SELECT COALESCE(SUM(amount_paid), 0) FROM payments",
    }
    totals = {
        key: float(connection.execute(sql).fetchone()[0])
        for key, sql in queries.items()
        if sql.rsplit(" ", 1)[-1] in tables
    }
    if "purchase_invoice_total" in totals and "payments_total" in totals:
        totals["outstanding_total"] = (
            totals["purchase_invoice_total"] - totals["payments_total"]
        )
    return totals


def reconcile(path: Path, backup_dir: Path) -> dict[str, object]:
    path = path.resolve()
    backup_dir = backup_dir.resolve()
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError(f"A non-empty SQLite database is required: {path}")
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = backup_dir / f"{path.stem}.pre-schema-reconciliation-{stamp}{path.suffix}"

    with sqlite3.connect(path) as source, sqlite3.connect(backup) as destination:
        source.backup(destination)
    with sqlite3.connect(backup) as check:
        if check.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Verified backup integrity check failed")
        if check.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("Verified backup has foreign-key violations")

    connection = sqlite3.connect(path)
    try:
        before_counts = _counts(connection)
        before_digests = _row_digests(connection)
        before_financial = _financial_totals(connection)
        connection.commit()
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("BEGIN IMMEDIATE")
        changes = reconcile_sqlite_connection(connection)
        after_counts = _counts(connection)
        after_digests = _row_digests(connection)
        after_financial = _financial_totals(connection)
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
        if before_counts != after_counts:
            raise RuntimeError("Table counts changed; rolling back")
        if before_digests != after_digests:
            raise RuntimeError("Business row digests changed; rolling back")
        if before_financial != after_financial:
            raise RuntimeError("Financial totals changed; rolling back")
        if integrity != "ok" or foreign_keys:
            raise RuntimeError("Database verification failed; rolling back")
        connection.commit()
        connection.execute("PRAGMA foreign_keys=ON")
        return {
            "database": str(path),
            "backup": str(backup),
            "backup_sha256": hashlib.sha256(backup.read_bytes()).hexdigest(),
            "changes": changes,
            "counts": after_counts,
            "financial_totals": after_financial,
            "row_digests": after_digests,
            "integrity": integrity,
            "foreign_key_violations": len(foreign_keys),
        }
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    parser.add_argument("--backup-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Required safety acknowledgement; without it no write is performed.",
    )
    args = parser.parse_args()
    if not args.apply:
        parser.error("--apply is required after validating the target is a clone or approved DB")
    report = reconcile(args.database, args.backup_dir)
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
