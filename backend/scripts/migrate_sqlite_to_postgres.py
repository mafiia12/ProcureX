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

from sqlalchemy import JSON, Float, Numeric, create_engine, func, inspect, select

BACKEND_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))
sys.path.insert(0, str(SCRIPTS_DIR))

from database import Base  # noqa: E402

# Every module that defines a SQLAlchemy model must be imported so
# Base.metadata is complete before this script derives anything from it.
# Unlike alembic/env.py, there is no "later revision" ordering hazard here -
# this script only ever reads a fully-formed schema, so every model module
# is imported unconditionally.
import auth.models  # noqa: E402,F401
import construction_calculator.models  # noqa: E402,F401
import daily_report  # noqa: E402,F401
import document_capture.models  # noqa: E402,F401
import incoming_requests  # noqa: E402,F401
import price_comparisons  # noqa: E402,F401
import procurement_workflow  # noqa: E402,F401
import rfq  # noqa: E402,F401
import whatsapp.models  # noqa: E402,F401


# Historical safety net, frozen as of Alembic revision 0021: every table
# ProcureX's migration history has created. This is NOT the copy order (that
# is derived from Base.metadata.sorted_tables below, which is topologically
# correct by foreign key). It exists purely so that a model class quietly
# dropped, renamed, or missed by the import list above fails this script
# loudly instead of silently shrinking the copy plan.
KNOWN_TABLES = frozenset({
    "business_code_sequences", "suppliers", "customers", "projects", "items",
    "purchase_orders", "purchase_order_items", "purchase_order_receipts",
    "purchase_order_receipt_lines", "purchase_order_payments", "purchases",
    "purchase_items", "payments", "price_history", "settings",
    "incoming_purchase_requests", "incoming_purchase_request_items",
    "incoming_request_attachments", "incoming_request_general_attachments",
    "incoming_request_status_history", "incoming_request_internal_notes",
    "internal_notifications", "internal_purchase_documents",
    "internal_purchase_document_items",
    "price_comparisons", "price_comparison_rows", "price_comparison_supplier_offers",
    "rfqs", "rfq_items", "rfq_suppliers", "supplier_quotations",
    "supplier_quotation_lines", "supplier_quotation_attachments",
    "engineer_approvals", "engineer_approval_lines",
    "engineer_approval_supplier_offers", "approval_payments",
    "workflow_audit_events",
    "daily_reports",
    "users", "user_project_access",
    "whatsapp_processed_messages", "whatsapp_drafts", "whatsapp_settings",
    "purchase_request_documents", "purchase_request_document_files",
    "purchase_request_extracted_items", "purchase_request_item_candidates",
    "document_processing_jobs", "purchase_request_audit_events",
    "item_master_creation_requests",
    "construction_import_runs", "construction_import_issues",
    "construction_categories", "construction_work_items", "construction_materials",
    "construction_labor_roles", "construction_equipment", "construction_work_crews",
    "construction_crew_labor_members", "construction_crew_equipment",
    "construction_material_rates", "construction_productivity_rates",
    "construction_work_item_adjustments", "construction_market_aliases",
    "construction_calculation_sessions", "construction_calculation_material_results",
    "construction_calculation_labor_results", "construction_calculation_equipment_results",
    "construction_calculation_snapshots", "construction_purchase_request_links",
    "construction_purchase_request_item_links",
})

# Numeric/Float columns that are NOT a monetary amount. TOTALS below is
# derived automatically from every Numeric/Float column in the schema
# *except* the ones listed here - so a new money column added by a future
# migration is verified automatically, and a new non-money numeric column
# needs exactly one justified line to opt out. Do not add an entry without a
# real reason: an unjustified exclusion is a bug, not a total to skip.
NON_MONEY_NUMERIC_COLUMNS: dict[tuple[str, str], str] = {
    ("purchase_order_items", "quantity"): "quantity, not a monetary amount",
    ("purchase_order_items", "discount_pct"): "percentage rate, not a monetary amount",
    ("purchase_order_items", "vat_pct"): "percentage rate, not a monetary amount",
    ("purchase_order_receipts", "affected_quantity"): "quantity, not a monetary amount",
    ("purchase_order_receipt_lines", "ordered_quantity"): "quantity, not a monetary amount",
    ("purchase_order_receipt_lines", "previously_received_quantity"): "quantity, not a monetary amount",
    ("purchase_order_receipt_lines", "received_quantity"): "quantity, not a monetary amount",
    ("purchase_order_receipt_lines", "remaining_quantity"): "quantity, not a monetary amount",
    ("purchase_items", "quantity"): "quantity, not a monetary amount",
    ("purchase_items", "discount_pct"): "percentage rate, not a monetary amount",
    ("purchase_items", "vat_pct"): "percentage rate, not a monetary amount",
    ("price_history", "quantity"): "quantity, not a monetary amount",
    ("price_history", "discount_pct"): "percentage rate, not a monetary amount",
    ("price_history", "vat_pct"): "percentage rate, not a monetary amount",
    ("incoming_purchase_request_items", "quantity"): "quantity, not a monetary amount",
    ("internal_purchase_document_items", "quantity"): "quantity, not a monetary amount",
    ("price_comparison_rows", "quantity"): "quantity, not a monetary amount",
    ("price_comparison_rows", "discount_pct"): "percentage rate, not a monetary amount",
    ("price_comparison_rows", "tax_pct"): "percentage rate, not a monetary amount",
    ("price_comparison_supplier_offers", "discount_pct"): "percentage rate, not a monetary amount",
    ("price_comparison_supplier_offers", "tax_pct"): "percentage rate, not a monetary amount",
    ("rfq_items", "quantity"): "quantity, not a monetary amount",
    ("supplier_quotation_lines", "quantity"): "quantity, not a monetary amount",
    ("supplier_quotation_lines", "discount_pct"): "percentage rate, not a monetary amount",
    ("supplier_quotation_lines", "tax_pct"): "percentage rate, not a monetary amount",
    ("engineer_approval_lines", "quantity"): "quantity, not a monetary amount",
    ("engineer_approval_lines", "discount_pct"): "percentage rate, not a monetary amount",
    ("engineer_approval_lines", "tax_pct"): "percentage rate, not a monetary amount",
    ("engineer_approval_supplier_offers", "discount_pct"): "percentage rate, not a monetary amount",
    ("engineer_approval_supplier_offers", "tax_pct"): "percentage rate, not a monetary amount",
    ("purchase_request_documents", "ocr_confidence"): "OCR confidence score, not a monetary amount",
    ("purchase_request_extracted_items", "quantity"): "quantity, not a monetary amount",
    ("purchase_request_extracted_items", "extraction_confidence"): "extraction confidence score, not a monetary amount",
    ("purchase_request_item_candidates", "score"): "match-ranking score, not a monetary amount",
    # construction_calculator is an inactive, historical-compatibility-only
    # module (CONSTRUCTION_API_ENABLED=false) - every Numeric column in it is
    # a material/labor/equipment consumption rate, percentage, quantity, or
    # duration. Pricing lives in RFQ/PO/CMP, never in this module.
    ("construction_materials", "package_capacity"): "packaging quantity, not a monetary amount",
    ("construction_material_rates", "fixed_rate"): "material consumption rate, not a monetary amount",
    ("construction_material_rates", "minimum_rate"): "material consumption rate, not a monetary amount",
    ("construction_material_rates", "maximum_rate"): "material consumption rate, not a monetary amount",
    ("construction_material_rates", "basis_quantity"): "quantity, not a monetary amount",
    ("construction_material_rates", "waste_percentage"): "percentage rate, not a monetary amount",
    ("construction_productivity_rates", "daily_productivity"): "productivity rate, not a monetary amount",
    ("construction_work_item_adjustments", "fixed_percentage"): "percentage rate, not a monetary amount",
    ("construction_work_item_adjustments", "minimum_percentage"): "percentage rate, not a monetary amount",
    ("construction_work_item_adjustments", "maximum_percentage"): "percentage rate, not a monetary amount",
    ("construction_calculation_sessions", "measured_quantity"): "quantity, not a monetary amount",
    ("construction_calculation_sessions", "execution_quantity"): "quantity, not a monetary amount",
    ("construction_calculation_sessions", "required_days"): "duration, not a monetary amount",
    ("construction_calculation_sessions", "theoretical_duration"): "duration, not a monetary amount",
    ("construction_calculation_sessions", "selected_adjustment_percentage"): "percentage rate, not a monetary amount",
    ("construction_calculation_material_results", "selected_rate"): "material consumption rate, not a monetary amount",
    ("construction_calculation_material_results", "minimum_rate"): "material consumption rate, not a monetary amount",
    ("construction_calculation_material_results", "maximum_rate"): "material consumption rate, not a monetary amount",
    ("construction_calculation_material_results", "base_quantity"): "quantity, not a monetary amount",
    ("construction_calculation_material_results", "waste_percentage"): "percentage rate, not a monetary amount",
    ("construction_calculation_material_results", "waste_quantity"): "quantity, not a monetary amount",
    ("construction_calculation_material_results", "required_quantity"): "quantity, not a monetary amount",
    ("construction_calculation_material_results", "package_capacity"): "packaging quantity, not a monetary amount",
    ("construction_calculation_material_results", "purchased_quantity"): "quantity, not a monetary amount",
    ("construction_calculation_material_results", "rounding_surplus"): "leftover quantity, not a monetary amount",
    ("construction_purchase_request_item_links", "engineering_quantity"): "quantity, not a monetary amount",
    ("construction_purchase_request_item_links", "purchase_quantity"): "quantity, not a monetary amount",
}


def _all_numeric_columns() -> set[tuple[str, str]]:
    return {
        (table.name, column.name)
        for table in Base.metadata.sorted_tables
        for column in table.columns
        if isinstance(column.type, (Float, Numeric))
    }


def _discover_money_totals() -> dict[str, list[str]]:
    totals: dict[str, list[str]] = {}
    for table in Base.metadata.sorted_tables:
        columns = [
            column.name for column in table.columns
            if isinstance(column.type, (Float, Numeric))
            and (table.name, column.name) not in NON_MONEY_NUMERIC_COLUMNS
        ]
        if columns:
            totals[table.name] = sorted(columns)
    return totals


_stale_exclusions = set(NON_MONEY_NUMERIC_COLUMNS) - _all_numeric_columns()
if _stale_exclusions:
    raise SystemExit(
        "NON_MONEY_NUMERIC_COLUMNS references columns that no longer exist "
        f"as Numeric/Float (renamed, retyped, or removed?): {sorted(_stale_exclusions)}"
    )

TOTALS = _discover_money_totals()

# This script has no logic to reset a PostgreSQL sequence after copying
# explicit primary-key values (no `setval(pg_get_serial_sequence(...))`
# anywhere below) - because today there is no such sequence to reset: every
# primary key in this schema is an application-generated string (see
# KNOWN_TABLES). autoincrement_primary_keys() (in schema_guards.py, kept
# dependency-free so it can be unit-tested without importing every model)
# catches the day a future model introduces an autoincrementing integer
# primary key instead: copying its explicit id values the same way as today
# would leave PostgreSQL's sequence unaware of them, and the next ordinary
# INSERT could collide with an already-migrated row.
from schema_guards import autoincrement_primary_keys  # noqa: E402


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


def _copy_order() -> list:
    return list(Base.metadata.sorted_tables)


def snapshot_sqlite(connection: sqlite3.Connection) -> dict:
    existing = {row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    counts = {}
    totals = {}
    row_counts = {}
    for table in _copy_order():
        table_name = table.name
        count = (
            connection.execute(f'SELECT COUNT(*) FROM "{table_name}"').fetchone()[0]
            if table_name in existing else 0
        )
        counts[table_name] = count
        row_counts[table_name] = count
    for table_name, columns in TOTALS.items():
        if table_name not in existing:
            continue
        totals[table_name] = {
            column: str(Decimal(str(connection.execute(
                f'SELECT COALESCE(SUM("{column}"), 0) FROM "{table_name}"'
            ).fetchone()[0] or 0)).quantize(Decimal("0.000001")))
            for column in columns
        }
    return {"counts": counts, "totals": totals, "row_counts": row_counts}


def snapshot_postgres(connection) -> dict:
    counts = {}
    totals = {}
    row_counts = {}
    for table in _copy_order():
        count = connection.scalar(select(func.count()).select_from(table))
        counts[table.name] = count
        row_counts[table.name] = count
    for table_name, columns in TOTALS.items():
        table = Base.metadata.tables[table_name]
        totals[table_name] = {
            column: str(Decimal(str(connection.scalar(
                select(func.coalesce(func.sum(table.c[column]), 0))
            ) or 0)).quantize(Decimal("0.000001")))
            for column in columns
        }
    return {"counts": counts, "totals": totals, "row_counts": row_counts}


def snapshot_postgres_readonly(target_url: str) -> dict | None:
    """Best-effort read-only target snapshot for the dry-run row-count
    report. Never writes; returns None if the target isn't reachable so
    dry-run stays usable without a live target configured."""
    try:
        engine = create_engine(target_url, pool_pre_ping=True)
        with engine.connect() as connection:
            existing = set(inspect(engine).get_table_names())
            if not existing:
                return None
            return snapshot_postgres(connection)
    except Exception:
        return None
    finally:
        try:
            engine.dispose()
        except Exception:
            pass


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


def _row_count_report(source_counts: dict, target_counts: dict | None) -> dict:
    return {
        table_name: {
            "source": source_count,
            "target": None if target_counts is None else target_counts.get(table_name, 0),
        }
        for table_name, source_count in source_counts.items()
    }


def main() -> int:
    known_missing = KNOWN_TABLES - set(Base.metadata.tables)
    if known_missing:
        raise SystemExit(
            "KNOWN_TABLES lists tables missing from Base.metadata - a model "
            "class was removed, renamed, or this script stopped importing "
            f"its module: {sorted(known_missing)}"
        )

    unhandled_autoincrement = autoincrement_primary_keys(Base.metadata)
    if unhandled_autoincrement:
        raise SystemExit(
            "This script has no PostgreSQL sequence-sync logic, but these "
            "primary keys would be Postgres SERIAL/IDENTITY columns that "
            f"need one after copying explicit values: {sorted(unhandled_autoincrement)}. "
            "Add setval(pg_get_serial_sequence(...), MAX(id)) handling for "
            "them before using this script, or make the primary key an "
            "explicit non-autoincrementing value (e.g. autoincrement=False, "
            "or a string) if that was unintentional."
        )

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
        sqlite_tables = {
            row[0] for row in source_connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name NOT LIKE 'sqlite_%' AND name <> 'alembic_version'"
            )
        }
        unknown_sqlite_tables = sqlite_tables - set(Base.metadata.tables)
        if unknown_sqlite_tables:
            raise SystemExit(
                "The SQLite source has tables this script does not know about "
                "(a migration added a table and this script's model imports "
                f"were not updated): {sorted(unknown_sqlite_tables)}"
            )
        source_snapshot = snapshot_sqlite(source_connection)

    target_url = normalize_postgres_url(args.target_url) if args.target_url else None
    # Only ever probe a target that is actually PostgreSQL. DATABASE_URL
    # defaults to the same SQLite file in local development (loaded via
    # database.py's load_dotenv), and comparing the source file against
    # itself would silently report a fake "match" instead of "no target".
    target_readonly_snapshot = (
        snapshot_postgres_readonly(target_url)
        if target_url and target_url.startswith("postgresql+psycopg://")
        else None
    )
    row_count_report = _row_count_report(
        source_snapshot["row_counts"],
        target_readonly_snapshot["row_counts"] if target_readonly_snapshot else None,
    )

    report = {
        "mode": "execute" if args.execute else "dry-run",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": str(args.sqlite.resolve()),
        "source_sha256": sha256(args.sqlite),
        "sqlite_integrity": "ok",
        "sqlite_foreign_key_violations": 0,
        "source_snapshot": source_snapshot,
        "money_totals_columns": TOTALS,
        "row_count_report": row_count_report,
    }
    if not args.execute:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    if not target_url:
        raise SystemExit("--target-url or TARGET_DATABASE_URL is required with --execute")
    if not target_url.startswith("postgresql+psycopg://"):
        raise SystemExit("The migration target must be PostgreSQL")

    backup_path = create_sqlite_backup(args.sqlite, args.backup_dir)
    report["backup"] = str(backup_path)
    report["backup_sha256"] = sha256(backup_path)
    target_engine = create_engine(target_url, pool_pre_ping=True)
    required = set(Base.metadata.tables)
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
            for table in _copy_order():
                if table.name not in source_tables:
                    continue
                rows = source_connection.execute(f'SELECT * FROM "{table.name}"').fetchall()
                if rows:
                    target_connection.execute(table.insert(), [decode_row(table, row) for row in rows])
        target_after = snapshot_postgres(target_connection)
        verify(source_snapshot, target_after)
        report["target_snapshot"] = target_after
        report["row_count_report"] = _row_count_report(
            source_snapshot["row_counts"], target_after["row_counts"],
        )
        report["verified"] = True

    serialized = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.write_text(serialized + "\n", encoding="utf-8")
    print(serialized)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
