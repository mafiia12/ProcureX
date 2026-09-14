"""Authoritative ProcureX SQLite schema contract for baseline reconciliation.

The contract changes schema metadata only.  It never updates business rows and
is intentionally limited to defaults, one check constraint, and one logical
index that differ between the legacy runtime and Alembic-created databases.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

from sqlalchemy import inspect


HEAD_REVISION = "0023_price_comparison_selection"

# SQL expressions as they must appear in the database schema.  These defaults
# already describe the values used by the application and legacy SQLite
# bootstrap helpers; adding them does not backfill or rewrite existing rows.
AUTHORITATIVE_DEFAULTS: dict[str, dict[str, str]] = {
    "items": {
        "product_name": "''",
        "brand": "''",
        "main_category": "''",
        "subcategory": "''",
        "specifications": "''",
        "name_ar": "''",
        "name_en": "''",
        "alternative_names": "'[]'",
        "search_aliases": "'[]'",
    },
    "purchase_items": {
        "product_name": "''",
        "brand": "''",
        "main_category": "''",
        "subcategory": "''",
        "specifications": "''",
    },
    "price_history": {
        "product_name": "''",
        "brand": "''",
        "main_category": "''",
        "subcategory": "''",
        "specifications": "''",
    },
    "incoming_purchase_requests": {
        "company_name": "''",
        "whatsapp_number": "''",
        "email": "''",
        "notes": "''",
        "status": "'new'",
        "assigned_employee": "''",
        "requester_ip_hash": "''",
        "user_agent_hash": "''",
        "converted_customer_id": "''",
        "conversion_type": "''",
        "converted_document_id": "''",
        "project_id": "''",
        "customer_id": "''",
        "customer_name": "''",
        "source_request_id": "''",
        "source_item_id": "''",
    },
    "incoming_purchase_request_items": {
        "preferred_brand": "''",
        "main_category": "''",
        "subcategory": "''",
        "specifications": "''",
        "review_status": "'pending'",
        "review_reason": "''",
        "reviewed_by": "''",
        "reviewed_at": "''",
        "hold_since": "''",
        "approved_unit_price": "0",
        "approved_price_note": "''",
    },
    "incoming_request_status_history": {
        "from_status": "''",
        "changed_by": "''",
        "note": "''",
    },
    "incoming_request_internal_notes": {"author": "''"},
    "internal_notifications": {"message": "''", "is_read": "0"},
    "internal_purchase_documents": {
        "status": "'draft'",
        "company_name": "''",
        "customer_id": "''",
        "project_location": "''",
        "delivery_location": "''",
        "required_delivery_date": "''",
        "notes": "''",
        "created_by": "''",
    },
    "internal_purchase_document_items": {
        "preferred_brand": "''",
        "main_category": "''",
        "subcategory": "''",
        "specifications": "''",
    },
    "price_comparisons": {
        "project_name": "''",
        "customer_name": "''",
        "source_request_id": "''",
        "source_request_number": "''",
        "notes": "''",
    },
    "price_comparison_rows": {
        "brand": "''",
        "main_category": "''",
        "subcategory": "''",
        "specifications": "''",
        "unit": "''",
        "unit_price": "0",
        "discount_pct": "0",
        "tax_pct": "0",
        "shipping_cost": "0",
        "other_cost": "0",
        "delivery_days": "0",
        "payment_terms": "''",
        "availability": "'available'",
        "price_valid_until": "''",
        "notes": "''",
        "selected_for_purchase": "0",
    },
    "price_comparison_supplier_offers": {
        "discount_pct": "0",
        "tax_pct": "0",
        "shipping_cost": "0",
        "other_cost": "0",
    },
    "engineer_approval_supplier_offers": {
        "supplier_id": "''",
        "supplier_name": "''",
        "discount_pct": "0",
        "tax_pct": "0",
        "shipping_cost": "0",
        "other_cost": "0",
    },
    "purchase_orders": {
        "source_request_id": "''",
        "source_request_number": "''",
        "approval_id": "''",
        "approval_number": "''",
    },
    "engineer_approvals": {
        "approval_type": "'external_engineer'",
        "approval_stage": "'external_review'",
        "responsible_role": "'external_engineer'",
    },
}

BUSINESS_CODE_CHECK = "next_value > 0"


class _ConnectionAdapter:
    """Use one execute API for sqlite3 and SQLAlchemy migration connections."""

    def __init__(self, connection):
        self.connection = connection

    def execute(self, statement: str, parameters=()):
        if hasattr(self.connection, "exec_driver_sql"):
            return self.connection.exec_driver_sql(statement, parameters)
        return self.connection.execute(statement, parameters)


def _adapt(connection):
    return connection if isinstance(connection, _ConnectionAdapter) else _ConnectionAdapter(connection)


def normalize_default(value: object) -> str | None:
    """Normalize SQLite/SQLAlchemy spelling without changing semantics."""
    if value is None:
        return None
    normalized = str(value).strip()
    while normalized.startswith("(") and normalized.endswith(")"):
        normalized = normalized[1:-1].strip()
    if len(normalized) >= 2 and normalized[0] == normalized[-1] == '"':
        normalized = "'" + normalized[1:-1].replace("'", "''") + "'"
    return normalized


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _application_tables(connection) -> set[str]:
    return {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    }


def _table_sql(connection, table: str) -> str:
    row = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    if not row or not row[0]:
        raise RuntimeError(f"Missing CREATE TABLE SQL for {table}")
    return row[0]


def _column_default_mismatches(connection, table: str) -> dict[str, str]:
    expected = AUTHORITATIVE_DEFAULTS.get(table, {})
    actual = {
        row[1]: normalize_default(row[4])
        for row in connection.execute(f"PRAGMA table_info({_quote_identifier(table)})")
    }
    return {
        column: default
        for column, default in expected.items()
        if column in actual and actual[column] != normalize_default(default)
    }


def _inject_default(create_sql: str, column: str, default: str) -> str:
    # SQLite's stored DDL uses one physical line per column in every supported
    # ProcureX schema.  Limiting the match to a single line avoids touching
    # similarly named constraints or foreign keys.
    pattern = re.compile(
        rf'(?im)^(\s*"?{re.escape(column)}"?\s+[^,\r\n]*?\bNOT\s+NULL)'
        rf'(?:\s+DEFAULT\s+(?:\'[^\']*\'|"[^"]*"|[^\s,]+))?(\s*)(,?)$'
    )
    replaced, count = pattern.subn(rf"\1 DEFAULT {default}\2\3", create_sql, count=1)
    if count != 1:
        raise RuntimeError(f"Could not add authoritative default for {column}")
    return replaced


def _rebuild_table(connection, table: str, defaults: dict[str, str]) -> None:
    original_sql = _table_sql(connection, table)
    rebuilt_sql = original_sql
    for column, default in defaults.items():
        rebuilt_sql = _inject_default(rebuilt_sql, column, default)

    temporary = f"__procurex_reconcile_{table}"
    create_pattern = re.compile(
        rf'(?i)^(CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+)(?:"{re.escape(table)}"|{re.escape(table)})'
    )
    temporary_sql, count = create_pattern.subn(
        rf'\1{_quote_identifier(temporary)}', rebuilt_sql, count=1
    )
    if count != 1:
        raise RuntimeError(f"Could not prepare replacement table for {table}")

    indexes = [
        row[0]
        for row in connection.execute(
            "SELECT sql FROM sqlite_master "
            "WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name",
            (table,),
        )
    ]
    columns = [
        row[1]
        for row in connection.execute(f"PRAGMA table_info({_quote_identifier(table)})")
    ]
    column_list = ", ".join(_quote_identifier(column) for column in columns)
    before = connection.execute(
        f"SELECT COUNT(*) FROM {_quote_identifier(table)}"
    ).fetchone()[0]

    connection.execute(f"DROP TABLE IF EXISTS {_quote_identifier(temporary)}")
    connection.execute(temporary_sql)
    connection.execute(
        f"INSERT INTO {_quote_identifier(temporary)} ({column_list}) "
        f"SELECT {column_list} FROM {_quote_identifier(table)}"
    )
    copied = connection.execute(
        f"SELECT COUNT(*) FROM {_quote_identifier(temporary)}"
    ).fetchone()[0]
    if copied != before:
        raise RuntimeError(
            f"Row-count mismatch while rebuilding {table}: {before} != {copied}"
        )
    connection.execute(f"DROP TABLE {_quote_identifier(table)}")
    connection.execute(
        f"ALTER TABLE {_quote_identifier(temporary)} RENAME TO {_quote_identifier(table)}"
    )
    for statement in indexes:
        connection.execute(statement)


def _ensure_business_code_check(connection) -> bool:
    tables = _application_tables(connection)
    if "business_code_sequences" not in tables:
        return False
    sql = _table_sql(connection, "business_code_sequences")
    compact = re.sub(r"\s+", " ", sql).lower()
    if re.search(r"check\s*\(\s*next_value\s*>\s*0\s*\)", compact):
        return False
    pattern = re.compile(
        r'(?im)^(\s*"?next_value"?\s+[^,\r\n]*?\bNOT\s+NULL)(\s*)(,?)$'
    )
    replacement, count = pattern.subn(
        r"\1 CHECK (next_value > 0)\2\3", sql, count=1
    )
    if count != 1:
        raise RuntimeError("Could not add the business-code positive check")

    # Reuse the rebuild routine's safety flow with a temporary, explicit DDL.
    temporary = "__procurex_reconcile_business_code_sequences"
    temporary_sql = re.sub(
        r"(?i)^(CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+)"
        r'(?:"business_code_sequences"|business_code_sequences)',
        rf'\1{_quote_identifier(temporary)}',
        replacement,
        count=1,
    )
    indexes = [
        row[0]
        for row in connection.execute(
            "SELECT sql FROM sqlite_master WHERE type='index' "
            "AND tbl_name='business_code_sequences' AND sql IS NOT NULL ORDER BY name"
        )
    ]
    before = connection.execute(
        "SELECT COUNT(*) FROM business_code_sequences"
    ).fetchone()[0]
    connection.execute(f"DROP TABLE IF EXISTS {_quote_identifier(temporary)}")
    connection.execute(temporary_sql)
    connection.execute(
        f"INSERT INTO {_quote_identifier(temporary)} (entity, next_value) "
        "SELECT entity, next_value FROM business_code_sequences"
    )
    copied = connection.execute(
        f"SELECT COUNT(*) FROM {_quote_identifier(temporary)}"
    ).fetchone()[0]
    if copied != before:
        raise RuntimeError("Business-code sequence row count changed during reconciliation")
    connection.execute("DROP TABLE business_code_sequences")
    connection.execute(
        f"ALTER TABLE {_quote_identifier(temporary)} RENAME TO business_code_sequences"
    )
    for statement in indexes:
        connection.execute(statement)
    return True


def _ensure_notification_index(connection) -> bool:
    if "internal_notifications" not in _application_tables(connection):
        return False
    indexes = {
        row[1]: tuple(
            item[2]
            for item in connection.execute(
                f"PRAGMA index_info({_quote_identifier(row[1])})"
            )
        )
        for row in connection.execute("PRAGMA index_list(internal_notifications)")
        if row[3] == "c"
    }
    desired = ("is_read", "created_at")
    changed = False
    if indexes.get("ix_internal_notifications_is_read") == ("is_read",):
        connection.execute("DROP INDEX ix_internal_notifications_is_read")
        changed = True
    if desired not in indexes.values():
        connection.execute(
            "CREATE INDEX ix_internal_notifications_unread "
            "ON internal_notifications(is_read, created_at)"
        )
        changed = True
    return changed


def _ensure_corrected_request_ancestry(connection) -> list[str]:
    if "incoming_purchase_requests" not in _application_tables(connection):
        return []
    columns = {
        row[1] for row in connection.execute("PRAGMA table_info(incoming_purchase_requests)")
    }
    added = []
    for column in ("source_request_id", "source_item_id"):
        if column not in columns:
            connection.execute(
                f"ALTER TABLE incoming_purchase_requests ADD COLUMN {column} "
                "VARCHAR DEFAULT '' NOT NULL"
            )
            added.append(column)
        connection.execute(
            f"CREATE INDEX IF NOT EXISTS ix_incoming_purchase_requests_{column} "
            f"ON incoming_purchase_requests ({column})"
        )
    return added


def reconcile_sqlite_connection(connection) -> dict[str, object]:
    """Reconcile one SQLite connection inside the caller's transaction.

    The caller must disable foreign-key enforcement before beginning the
    transaction.  A full ``foreign_key_check`` must be run before commit.
    """
    connection = _adapt(connection)
    if connection.execute("PRAGMA foreign_keys").fetchone()[0] != 0:
        raise RuntimeError(
            "Schema reconciliation requires PRAGMA foreign_keys=OFF before BEGIN"
        )
    tables = _application_tables(connection)
    rebuilt: list[str] = []
    for table in AUTHORITATIVE_DEFAULTS:
        if table not in tables:
            continue
        mismatches = _column_default_mismatches(connection, table)
        if mismatches:
            _rebuild_table(connection, table, mismatches)
            rebuilt.append(table)
    check_added = _ensure_business_code_check(connection)
    index_changed = _ensure_notification_index(connection)
    ancestry_columns_added = _ensure_corrected_request_ancestry(connection)
    return {
        "rebuilt_tables": rebuilt,
        "business_code_check_added": check_added,
        "notification_index_changed": index_changed,
        "corrected_request_ancestry_columns_added": ancestry_columns_added,
    }


def reconcile_business_code_check(connection) -> bool:
    """Reconcile only the 0002 positive-counter constraint."""
    connection = _adapt(connection)
    if connection.execute("PRAGMA foreign_keys").fetchone()[0] != 0:
        raise RuntimeError(
            "Schema reconciliation requires PRAGMA foreign_keys=OFF before BEGIN"
        )
    return _ensure_business_code_check(connection)

def reconcile_non_sqlite_connection(bind, tables: Iterable[str] | None = None) -> None:
    """Apply the same contract on PostgreSQL without rebuilding tables."""
    available = set(inspect(bind).get_table_names())
    selected = set(tables or AUTHORITATIVE_DEFAULTS)
    for table in sorted(selected & available):
        columns = {column["name"] for column in inspect(bind).get_columns(table)}
        for column, default in AUTHORITATIVE_DEFAULTS.get(table, {}).items():
            if column in columns:
                bind.exec_driver_sql(
                    f"ALTER TABLE {_quote_identifier(table)} "
                    f"ALTER COLUMN {_quote_identifier(column)} SET DEFAULT {default}"
                )
    if "business_code_sequences" in available:
        checks = {item.get("name") for item in inspect(bind).get_check_constraints(
            "business_code_sequences"
        )}
        if "ck_business_code_sequences_positive" not in checks:
            bind.exec_driver_sql(
                "ALTER TABLE business_code_sequences ADD CONSTRAINT "
                "ck_business_code_sequences_positive CHECK (next_value > 0)"
            )
    if "internal_notifications" in available:
        bind.exec_driver_sql("DROP INDEX IF EXISTS ix_internal_notifications_is_read")
        bind.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_internal_notifications_unread "
            "ON internal_notifications(is_read, created_at)"
        )
