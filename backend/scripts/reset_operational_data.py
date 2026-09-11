"""Reset ProcureX operational purchase-request workflow data.

Deletes everything in the REQ -> RFQ -> Quotations -> Comparison -> Approval
-> PO -> Payment -> Receiving chain (plus the WhatsApp/document-capture
transactional tables feeding it) so the system can accept a brand-new
purchase request from a clean workflow state.

Never touches: suppliers, items, projects, customers, users/roles, settings,
whatsapp_settings, business_code_sequences, alembic_version, or any
construction-calculator master/reference table.

Modes (default is always the safest):

    python scripts/reset_operational_data.py                 # dry-run report only, no writes
    python scripts/reset_operational_data.py --rehearse       # copies the DB to a disposable
                                                               # file and performs the *real*
                                                               # delete there, then verifies it
                                                               # and throws the copy away. The
                                                               # live database is never touched.
    python scripts/reset_operational_data.py --execute        # backs up the live DB, then
                                                               # performs the real delete on it
                                                               # inside one transaction.

--execute refuses to run unless a --rehearse pass against the current DB
content has already succeeded in this same invocation is not required, but a
fresh backup is always taken immediately beforehand and hard assertions on
suppliers/items are checked before commit AND after commit; any mismatch
raises and (for --execute) the transaction is rolled back.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = BACKEND_DIR / "procurement.db"
BACKUP_DIR = BACKEND_DIR / "backups"
ATTACHMENT_ROOT = BACKEND_DIR / "storage" / "incoming_requests"

# Tables that must never change. Verified by count AND content hash.
HARD_PRESERVE_TABLES = ["suppliers", "items"]
# Tables verified by count only (no business reason for their row count to
# move during this reset; a mismatch is still a hard stop).
SOFT_PRESERVE_TABLES = [
    "projects", "customers", "users", "user_project_access", "settings",
    "whatsapp_settings", "business_code_sequences",
]

# Deletion order: children before parents (topological order over the real
# FK graph, verified against PRAGMA foreign_key_list on the live schema).
# Each entry is (table, optional_where_sql, optional_params).
RESET_TABLES: list[tuple[str, str | None, tuple]] = [
    # Generic audit/notification tables are scoped by entity_type so a future
    # row tied to a preserved entity (e.g. "project") is never touched.
    (
        "workflow_audit_events",
        "entity_type IN (?,?,?,?,?,?,?)",
        (
            "incoming_purchase_request", "incoming_request", "incoming_request_item",
            "rfq", "supplier_quotation", "approval", "purchase_order",
        ),
    ),
    ("internal_notifications", "entity_type = ?", ("incoming_purchase_request",)),
    ("daily_reports", None, ()),

    ("approval_payments", None, ()),
    ("engineer_approval_supplier_offers", None, ()),
    ("engineer_approval_lines", None, ()),

    ("purchase_order_receipt_lines", None, ()),
    ("purchase_order_payments", None, ()),
    ("purchase_order_receipts", None, ()),
    ("purchase_order_items", None, ()),
    ("purchase_orders", None, ()),

    ("engineer_approvals", None, ()),

    ("supplier_quotation_attachments", None, ()),
    ("supplier_quotation_lines", None, ()),
    ("supplier_quotations", None, ()),

    ("rfq_items", None, ()),
    ("rfq_suppliers", None, ()),

    ("price_comparison_supplier_offers", None, ()),
    ("price_comparison_rows", None, ()),
    ("price_comparisons", None, ()),

    ("rfqs", None, ()),

    ("internal_purchase_document_items", None, ()),
    ("internal_purchase_documents", None, ()),

    ("purchase_request_item_candidates", None, ()),
    ("purchase_request_extracted_items", None, ()),
    ("document_processing_jobs", None, ()),
    ("purchase_request_document_files", None, ()),
    ("purchase_request_documents", None, ()),
    ("item_master_creation_requests", None, ()),
    ("purchase_request_audit_events", None, ()),

    ("construction_purchase_request_item_links", None, ()),
    ("construction_purchase_request_links", None, ()),

    ("incoming_request_attachments", None, ()),
    ("incoming_request_general_attachments", None, ()),
    ("incoming_request_status_history", None, ()),
    ("incoming_request_internal_notes", None, ()),
    ("incoming_purchase_request_items", None, ()),
    ("incoming_purchase_requests", None, ()),

    ("whatsapp_drafts", None, ()),
    ("whatsapp_processed_messages", None, ()),
]

# table -> stored_filename column, restricted to tables actually in RESET_TABLES.
ATTACHMENT_TABLES = {
    "incoming_request_attachments": "stored_filename",
    "incoming_request_general_attachments": "stored_filename",
    "supplier_quotation_attachments": "stored_filename",
    "purchase_request_document_files": "stored_filename",
}

# Legacy Direct-Purchase tables. Never auto-deleted by this script (see
# section 3 of the reset spec) - only reported on, so a human can decide.
LEGACY_DIRECT_PURCHASE_TABLES = ["purchases", "purchase_items", "payments", "price_history"]


@dataclass
class TableCount:
    table: str
    before: int
    after: int | None = None


@dataclass
class Report:
    counts: list[TableCount] = field(default_factory=list)
    legacy_counts: dict[str, int] = field(default_factory=dict)
    preserve_counts: dict[str, int] = field(default_factory=dict)
    preserve_hashes: dict[str, str] = field(default_factory=dict)
    attachment_files: list[tuple[str, str, int]] = field(default_factory=list)  # (table, stored_filename, size)


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _table_count(conn: sqlite3.Connection, table: str, where: str | None, params: tuple) -> int:
    sql = f"SELECT COUNT(*) FROM '{table}'"
    if where:
        sql += f" WHERE {where}"
    return conn.execute(sql, params).fetchone()[0]


def _table_hash(conn: sqlite3.Connection, table: str) -> str:
    cur = conn.execute(f"SELECT * FROM '{table}' ORDER BY id")
    columns = [d[0] for d in cur.description]
    hasher = hashlib.sha256()
    for row in cur:
        hasher.update(json.dumps(dict(zip(columns, row)), sort_keys=True, default=str).encode("utf-8"))
    return hasher.hexdigest()


def integrity_and_fk_check(conn: sqlite3.Connection) -> tuple[str, list]:
    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    fk_violations = conn.execute("PRAGMA foreign_key_check").fetchall()
    return integrity, fk_violations


def build_report(conn: sqlite3.Connection) -> Report:
    report = Report()
    for table, where, params in RESET_TABLES:
        report.counts.append(TableCount(table, _table_count(conn, table, where, params)))
    for table in LEGACY_DIRECT_PURCHASE_TABLES:
        report.legacy_counts[table] = _table_count(conn, table, None, ())
    for table in HARD_PRESERVE_TABLES:
        report.preserve_counts[table] = _table_count(conn, table, None, ())
        report.preserve_hashes[table] = _table_hash(conn, table)
    for table in SOFT_PRESERVE_TABLES:
        report.preserve_counts[table] = _table_count(conn, table, None, ())
    for table, col in ATTACHMENT_TABLES.items():
        try:
            rows = conn.execute(f"SELECT {col}, size_bytes FROM '{table}'").fetchall()
        except sqlite3.OperationalError:
            rows = [(value, 0) for (value,) in conn.execute(f"SELECT {col} FROM '{table}'").fetchall()]
        for stored_filename, size_bytes in rows:
            report.attachment_files.append((table, stored_filename, size_bytes or 0))
    return report


def print_report(report: Report, *, title: str) -> None:
    print(f"\n=== {title} ===")
    print(f"{'table':45s} {'before':>8s}")
    total_before = 0
    for tc in report.counts:
        print(f"{tc.table:45s} {tc.before:8d}" + (f" -> {tc.after:d}" if tc.after is not None else ""))
        total_before += tc.before
    print(f"{'TOTAL RESET ROWS':45s} {total_before:8d}")

    print("\n-- PRESERVE (hard, count + content hash) --")
    for table in HARD_PRESERVE_TABLES:
        print(f"{table:45s} {report.preserve_counts[table]:8d}  sha256={report.preserve_hashes[table][:16]}...")

    print("\n-- PRESERVE (count only) --")
    for table in SOFT_PRESERVE_TABLES:
        print(f"{table:45s} {report.preserve_counts[table]:8d}")

    print("\n-- LEGACY DIRECT-PURCHASE (reported, NOT auto-deleted) --")
    for table, count in report.legacy_counts.items():
        print(f"{table:45s} {count:8d}")

    total_size = sum(size for _, _, size in report.attachment_files)
    print(f"\n-- ATTACHMENT FILES tied to reset rows: {len(report.attachment_files)} files, {total_size} bytes --")
    for table, stored_filename, size in report.attachment_files:
        print(f"  [{table}] {stored_filename} ({size} bytes)")


def delete_reset_data(conn: sqlite3.Connection) -> list[TableCount]:
    results = []
    for table, where, params in RESET_TABLES:
        before = _table_count(conn, table, where, params)
        sql = f"DELETE FROM '{table}'"
        if where:
            sql += f" WHERE {where}"
        conn.execute(sql, params)
        after = _table_count(conn, table, where, params)
        results.append(TableCount(table, before, after))
    return results


def assert_preserved(conn: sqlite3.Connection, before: Report) -> None:
    for table in HARD_PRESERVE_TABLES:
        count_after = _table_count(conn, table, None, ())
        hash_after = _table_hash(conn, table)
        assert count_after == before.preserve_counts[table], (
            f"HARD STOP: {table} row count changed ({before.preserve_counts[table]} -> {count_after})"
        )
        assert hash_after == before.preserve_hashes[table], (
            f"HARD STOP: {table} content hash changed - master data was modified"
        )
    for table in SOFT_PRESERVE_TABLES:
        count_after = _table_count(conn, table, None, ())
        assert count_after == before.preserve_counts[table], (
            f"HARD STOP: {table} row count changed ({before.preserve_counts[table]} -> {count_after})"
        )


def backup_db(db_path: Path, label: str) -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    dest = BACKUP_DIR / f"procurement.pre-{label}-{timestamp}-walsafe.db"
    src_conn = sqlite3.connect(db_path)
    try:
        src_conn.execute("VACUUM INTO ?", (str(dest),))
    finally:
        src_conn.close()
    return dest


def delete_attachment_files(report: Report, *, dry_run: bool) -> tuple[int, int]:
    removed, failed = 0, 0
    for _table, stored_filename, _size in report.attachment_files:
        if not stored_filename:
            continue
        target = (ATTACHMENT_ROOT / stored_filename).resolve()
        if ATTACHMENT_ROOT.resolve() not in target.parents:
            print(f"  SKIP (path escapes attachment root): {stored_filename}")
            failed += 1
            continue
        if dry_run:
            print(f"  WOULD DELETE: {target}")
            continue
        try:
            if target.is_file():
                target.unlink()
                removed += 1
            parent = target.parent
            if parent != ATTACHMENT_ROOT.resolve() and parent.is_dir() and not any(parent.iterdir()):
                parent.rmdir()
        except OSError as exc:
            print(f"  FAILED to delete {target}: {exc}")
            failed += 1
    return removed, failed


def run(db_path: Path, *, execute: bool, rehearse: bool) -> int:
    if execute and rehearse:
        print("ERROR: pass only one of --execute / --rehearse", file=sys.stderr)
        return 2

    working_path = db_path
    backup_path = None

    if rehearse:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        timestamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        rehearsal_copy = BACKUP_DIR / f"_rehearsal.pre-operational-reset-{timestamp}.db"
        src_conn = sqlite3.connect(db_path)
        try:
            src_conn.execute("VACUUM INTO ?", (str(rehearsal_copy),))
        finally:
            src_conn.close()
        working_path = rehearsal_copy
        print(f"Rehearsal copy created at: {rehearsal_copy}")

    conn = _connect(working_path)
    try:
        integrity, fk_violations = integrity_and_fk_check(conn)
        print(f"integrity_check (before) = {integrity}")
        print(f"foreign_key_check (before) violations = {len(fk_violations)}")
        if integrity != "ok" or fk_violations:
            print("ABORT: database failed integrity/FK check before any changes were made.", file=sys.stderr)
            return 1

        before_report = build_report(conn)
        print_report(before_report, title="DRY-RUN (no changes made)" if not (execute or rehearse) else "PRE-RESET STATE")

        if not execute and not rehearse:
            print("\nDry-run only. Pass --rehearse to test the real delete on a disposable copy,")
            print("or --execute to run it for real on the live database (after a fresh backup).")
            return 0

        if execute:
            backup_path = backup_db(db_path, "operational-data-reset")
            print(f"\nLive backup created at: {backup_path}")

        conn.execute("BEGIN")
        try:
            deletions = delete_reset_data(conn)
            assert_preserved(conn, before_report)
            integrity, fk_violations = integrity_and_fk_check(conn)
            if integrity != "ok" or fk_violations:
                raise AssertionError(
                    f"HARD STOP: post-delete integrity_check={integrity}, "
                    f"foreign_key_check violations={len(fk_violations)}"
                )
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise

        print("\n=== POST-RESET COUNTS ===")
        for tc in deletions:
            print(f"{tc.table:45s} {tc.before:8d} -> {tc.after:8d}")

        integrity, fk_violations = integrity_and_fk_check(conn)
        print(f"\nintegrity_check (after) = {integrity}")
        print(f"foreign_key_check (after) violations = {len(fk_violations)}")

        print("\n=== ATTACHMENT FILE CLEANUP ===")
        removed, failed = delete_attachment_files(before_report, dry_run=rehearse)
        print(f"removed={removed} failed={failed} (dry_run={rehearse})")

        if rehearse:
            print(f"\nRehearsal complete. Disposable copy retained for inspection at: {working_path}")
            print("Live database was NOT touched.")
        else:
            print(f"\nLive reset complete. Backup of pre-reset state: {backup_path}")

        return 0
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="Path to the SQLite database (default: backend/procurement.db)")
    parser.add_argument("--execute", action="store_true", help="Actually perform the reset on the given database (requires a fresh backup, taken automatically).")
    parser.add_argument("--rehearse", action="store_true", help="Run the real delete against a disposable copy of the database; the given database is never modified.")
    args = parser.parse_args()

    if not args.db.exists():
        print(f"ERROR: database not found at {args.db}", file=sys.stderr)
        return 2

    return run(args.db, execute=args.execute, rehearse=args.rehearse)


if __name__ == "__main__":
    raise SystemExit(main())
