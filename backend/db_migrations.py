"""Small, data-preserving SQLite migrations for the local ProcureX database."""

from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import inspect, text


ITEM_CLASSIFICATION_SCHEMA_VERSION = 1
ITEM_IDENTITY_SCHEMA_VERSION = 2
INCOMING_REQUESTS_SCHEMA_VERSION = 3
BUSINESS_CODE_SCHEMA_VERSION = 4
SUPPLIER_PRICE_COMPARISON_SCHEMA_VERSION = 6
DOCUMENT_CAPTURE_SCHEMA_VERSION = 7
CONSTRUCTION_CALCULATOR_SCHEMA_VERSION = 8
GUIDED_PROCUREMENT_SCHEMA_VERSION = 10
SITE_RECEIVING_SCHEMA_VERSION = 11
AUTHENTICATION_SCHEMA_VERSION = 12
SITE_PORTAL_REQUESTS_SCHEMA_VERSION = 13
SITE_PORTAL_ATTACHMENTS_SCHEMA_VERSION = 14
RFQ_SUPPLIER_QUOTATIONS_SCHEMA_VERSION = 15
PO_PAYMENT_LEDGER_SCHEMA_VERSION = 16
SUPPLIER_OFFER_ADJUSTMENTS_SCHEMA_VERSION = 18
DAILY_REPORT_SCHEMA_VERSION = 19
WHATSAPP_INTAKE_SCHEMA_VERSION = 20
WHATSAPP_SETTINGS_SCHEMA_VERSION = 21


INCOMING_REQUEST_TABLES = {
    "incoming_purchase_requests",
    "incoming_purchase_request_items",
    "incoming_request_attachments",
    "incoming_request_status_history",
    "incoming_request_internal_notes",
    "internal_notifications",
    "internal_purchase_documents",
    "internal_purchase_document_items",
}


def _table_counts(connection: sqlite3.Connection) -> dict[str, int]:
    tables = [
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]
    return {
        table: connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        for table in tables
    }


def create_verified_backup(
    database_path: Path,
    backup_dir: Path | None = None,
    label: str = "schema-migration",
) -> Path:
    """Create a consistent online SQLite backup and verify integrity and row counts."""
    database_path = database_path.resolve()
    if not database_path.is_file():
        raise FileNotFoundError(f"Database does not exist: {database_path}")

    destination_dir = (backup_dir or database_path.parent / "backups").resolve()
    destination_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = destination_dir / (
        f"{database_path.stem}.pre-{label}-{stamp}{database_path.suffix}"
    )
    sequence = 1
    while destination.exists():
        destination = destination_dir / (
            f"{database_path.stem}.pre-{label}-{stamp}-{sequence}"
            f"{database_path.suffix}"
        )
        sequence += 1

    with sqlite3.connect(database_path) as source:
        source_integrity = source.execute("PRAGMA integrity_check").fetchone()[0]
        if source_integrity != "ok":
            raise RuntimeError(
                "Source database integrity check failed; no backup or schema change was made. "
                f"integrity={source_integrity!r}"
            )
        source_counts = _table_counts(source)
        with sqlite3.connect(destination) as target:
            source.backup(target)

    with sqlite3.connect(destination) as verification:
        integrity = verification.execute("PRAGMA integrity_check").fetchone()[0]
        backup_counts = _table_counts(verification)
    if integrity != "ok" or backup_counts != source_counts:
        raise RuntimeError(
            "Backup verification failed; the original database was not modified. "
            f"integrity={integrity!r}, counts_match={backup_counts == source_counts}"
        )
    return destination


def _database_path(engine) -> Path | None:
    if engine.url.get_backend_name() != "sqlite":
        return None
    configured = engine.url.database
    return Path(configured).resolve() if configured and configured != ":memory:" else None


def migrate_item_classification(engine) -> Path | None:
    """Add category hierarchy fields and preserve legacy categories verbatim."""
    inspector = inspect(engine)
    if "items" not in inspector.get_table_names():
        return None

    columns = {column["name"] for column in inspector.get_columns("items")}
    missing = {"main_category", "subcategory"} - columns
    needs_backfill = False
    if "main_category" in columns and "category" in columns:
        with engine.connect() as connection:
            needs_backfill = bool(
                connection.execute(
                    text(
                        "SELECT 1 FROM items "
                        "WHERE TRIM(COALESCE(main_category, '')) = '' "
                        "AND TRIM(COALESCE(category, '')) <> '' LIMIT 1"
                    )
                ).first()
            )
    if not missing and not needs_backfill:
        return None

    database_path = _database_path(engine)
    if database_path is None:
        raise RuntimeError("A file-backed SQLite database is required for safe migration")
    backup_path = create_verified_backup(database_path, label="item-classification")

    with engine.begin() as connection:
        if "main_category" not in columns:
            connection.exec_driver_sql(
                "ALTER TABLE items ADD COLUMN main_category VARCHAR NOT NULL DEFAULT ''"
            )
        if "subcategory" not in columns:
            connection.exec_driver_sql(
                "ALTER TABLE items ADD COLUMN subcategory VARCHAR NOT NULL DEFAULT ''"
            )
        if "category" in columns:
            connection.execute(
                text(
                    "UPDATE items SET main_category = category "
                    "WHERE TRIM(COALESCE(main_category, '')) = '' "
                    "AND TRIM(COALESCE(category, '')) <> ''"
                )
            )
        connection.exec_driver_sql(
            f"PRAGMA user_version = {ITEM_CLASSIFICATION_SCHEMA_VERSION}"
        )
    return backup_path


def migrate_item_identity(engine) -> Path | None:
    """Add normalized item identity and immutable purchase-history snapshots."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "items" not in tables:
        return None

    required = {
        "items": {"product_name", "brand", "specifications"},
        "purchase_items": {
            "product_name", "brand", "main_category", "subcategory",
            "specifications",
        },
        "price_history": {
            "product_name", "brand", "main_category", "subcategory",
            "specifications",
        },
    }
    columns = {
        table: {column["name"] for column in inspector.get_columns(table)}
        for table in required
        if table in tables
    }
    missing = {
        table: fields - columns.get(table, set())
        for table, fields in required.items()
        if table in tables
    }
    needs_backfill = False
    if not missing.get("items"):
        with engine.connect() as connection:
            needs_backfill = bool(
                connection.execute(
                    text(
                        "SELECT 1 FROM items WHERE "
                        "TRIM(COALESCE(product_name, '')) = '' OR "
                        "(TRIM(COALESCE(specifications, '')) = '' AND "
                        " TRIM(COALESCE(specs, '')) <> '') LIMIT 1"
                    )
                ).first()
            )
    if not needs_backfill:
        for table in ("purchase_items", "price_history"):
            if table in tables and not missing.get(table):
                with engine.connect() as connection:
                    needs_backfill = bool(
                        connection.execute(
                            text(
                                f"SELECT 1 FROM {table} WHERE "
                                "TRIM(COALESCE(product_name, '')) = '' AND "
                                "TRIM(COALESCE(item_name, '')) <> '' LIMIT 1"
                            )
                        ).first()
                    )
                if needs_backfill:
                    break
    if not any(missing.values()) and not needs_backfill:
        return None

    database_path = _database_path(engine)
    if database_path is None:
        raise RuntimeError("A file-backed SQLite database is required for safe migration")
    backup_path = create_verified_backup(database_path, label="item-identity")

    snapshot_fields = {
        "product_name": "VARCHAR NOT NULL DEFAULT ''",
        "brand": "VARCHAR NOT NULL DEFAULT ''",
        "main_category": "VARCHAR NOT NULL DEFAULT ''",
        "subcategory": "VARCHAR NOT NULL DEFAULT ''",
        "specifications": "TEXT NOT NULL DEFAULT ''",
    }
    with engine.begin() as connection:
        item_fields = {
            "product_name": "VARCHAR NOT NULL DEFAULT ''",
            "brand": "VARCHAR NOT NULL DEFAULT ''",
            "specifications": "TEXT NOT NULL DEFAULT ''",
        }
        for field, definition in item_fields.items():
            if field in missing.get("items", set()):
                connection.exec_driver_sql(
                    f"ALTER TABLE items ADD COLUMN {field} {definition}"
                )
        connection.execute(
            text(
                "UPDATE items SET "
                "product_name = CASE "
                "WHEN TRIM(COALESCE(product_name, '')) = '' THEN name "
                "ELSE product_name END, "
                "specifications = CASE "
                "WHEN TRIM(COALESCE(specifications, '')) = '' THEN specs "
                "ELSE specifications END"
            )
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_items_product_name ON items(product_name)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_items_brand ON items(brand)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_items_classification_product "
            "ON items(main_category, subcategory, brand, product_name)"
        )

        for table in ("purchase_items", "price_history"):
            if table not in tables:
                continue
            for field, definition in snapshot_fields.items():
                if field in missing.get(table, set()):
                    connection.exec_driver_sql(
                        f"ALTER TABLE {table} ADD COLUMN {field} {definition}"
                    )

        if "purchase_items" in tables:
            connection.execute(
                text(
                    "UPDATE purchase_items SET "
                    "product_name = COALESCE(NULLIF(product_name, ''), item_name), "
                    "brand = COALESCE((SELECT i.brand FROM items i "
                    " WHERE i.id = purchase_items.item_id), brand, ''), "
                    "main_category = COALESCE((SELECT i.main_category FROM items i "
                    " WHERE i.id = purchase_items.item_id), main_category, ''), "
                    "subcategory = COALESCE((SELECT i.subcategory FROM items i "
                    " WHERE i.id = purchase_items.item_id), subcategory, ''), "
                    "specifications = COALESCE((SELECT i.specifications FROM items i "
                    " WHERE i.id = purchase_items.item_id), specifications, '')"
                )
            )
        if "price_history" in tables:
            connection.execute(
                text(
                    "UPDATE price_history SET "
                    "product_name = COALESCE(NULLIF(product_name, ''), item_name), "
                    "brand = COALESCE((SELECT i.brand FROM items i "
                    " WHERE i.code = price_history.item_code), brand, ''), "
                    "main_category = COALESCE((SELECT i.main_category FROM items i "
                    " WHERE i.code = price_history.item_code), main_category, ''), "
                    "subcategory = COALESCE((SELECT i.subcategory FROM items i "
                    " WHERE i.code = price_history.item_code), subcategory, ''), "
                    "specifications = COALESCE((SELECT i.specifications FROM items i "
                    " WHERE i.code = price_history.item_code), specifications, '')"
                )
            )
        connection.exec_driver_sql(
            f"PRAGMA user_version = {ITEM_IDENTITY_SCHEMA_VERSION}"
        )
    return backup_path


def migrate_incoming_requests(engine) -> Path | None:
    """Create normalized incoming-request tables without changing existing data."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    missing_tables = INCOMING_REQUEST_TABLES - existing_tables
    with engine.connect() as connection:
        current_version = connection.exec_driver_sql("PRAGMA user_version").scalar_one()
    if not missing_tables and current_version >= INCOMING_REQUESTS_SCHEMA_VERSION:
        return None

    database_path = _database_path(engine)
    backup_path = None
    if existing_tables:
        if database_path is None:
            raise RuntimeError("A file-backed SQLite database is required for safe migration")
        backup_path = create_verified_backup(database_path, label="incoming-requests")

    statements = [
        """
        CREATE TABLE IF NOT EXISTS incoming_purchase_requests (
            id VARCHAR PRIMARY KEY,
            request_number VARCHAR NOT NULL UNIQUE,
            requester_name VARCHAR NOT NULL,
            company_name VARCHAR NOT NULL DEFAULT '',
            phone_number VARCHAR NOT NULL,
            whatsapp_number VARCHAR NOT NULL DEFAULT '',
            email VARCHAR NOT NULL DEFAULT '',
            project_name VARCHAR NOT NULL,
            project_location TEXT NOT NULL,
            delivery_location TEXT NOT NULL,
            required_delivery_date VARCHAR NOT NULL,
            priority VARCHAR NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            status VARCHAR NOT NULL DEFAULT 'new',
            assigned_employee VARCHAR NOT NULL DEFAULT '',
            submission_token VARCHAR NOT NULL UNIQUE,
            content_fingerprint VARCHAR NOT NULL,
            requester_ip_hash VARCHAR NOT NULL DEFAULT '',
            user_agent_hash VARCHAR NOT NULL DEFAULT '',
            converted_customer_id VARCHAR NOT NULL DEFAULT '',
            conversion_type VARCHAR NOT NULL DEFAULT '',
            converted_document_id VARCHAR NOT NULL DEFAULT '',
            created_at VARCHAR NOT NULL,
            updated_at VARCHAR NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS incoming_purchase_request_items (
            id VARCHAR PRIMARY KEY,
            request_id VARCHAR NOT NULL,
            position INTEGER NOT NULL,
            product_name VARCHAR NOT NULL,
            preferred_brand VARCHAR NOT NULL DEFAULT '',
            main_category VARCHAR NOT NULL DEFAULT '',
            subcategory VARCHAR NOT NULL DEFAULT '',
            specifications TEXT NOT NULL DEFAULT '',
            quantity FLOAT NOT NULL,
            unit VARCHAR NOT NULL,
            FOREIGN KEY(request_id) REFERENCES incoming_purchase_requests(id) ON DELETE CASCADE,
            UNIQUE(request_id, position)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS incoming_request_attachments (
            id VARCHAR PRIMARY KEY,
            request_item_id VARCHAR NOT NULL UNIQUE,
            original_filename VARCHAR NOT NULL,
            stored_filename VARCHAR NOT NULL UNIQUE,
            media_type VARCHAR NOT NULL,
            size_bytes INTEGER NOT NULL,
            sha256 VARCHAR NOT NULL,
            created_at VARCHAR NOT NULL,
            FOREIGN KEY(request_item_id) REFERENCES incoming_purchase_request_items(id) ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS incoming_request_status_history (
            id VARCHAR PRIMARY KEY,
            request_id VARCHAR NOT NULL,
            from_status VARCHAR NOT NULL DEFAULT '',
            to_status VARCHAR NOT NULL,
            changed_by VARCHAR NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            created_at VARCHAR NOT NULL,
            FOREIGN KEY(request_id) REFERENCES incoming_purchase_requests(id) ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS incoming_request_internal_notes (
            id VARCHAR PRIMARY KEY,
            request_id VARCHAR NOT NULL,
            author VARCHAR NOT NULL DEFAULT '',
            note TEXT NOT NULL,
            created_at VARCHAR NOT NULL,
            FOREIGN KEY(request_id) REFERENCES incoming_purchase_requests(id) ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS internal_notifications (
            id VARCHAR PRIMARY KEY,
            notification_type VARCHAR NOT NULL,
            entity_type VARCHAR NOT NULL,
            entity_id VARCHAR NOT NULL,
            title VARCHAR NOT NULL,
            message TEXT NOT NULL DEFAULT '',
            is_read INTEGER NOT NULL DEFAULT 0,
            created_at VARCHAR NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS internal_purchase_documents (
            id VARCHAR PRIMARY KEY,
            document_number VARCHAR NOT NULL UNIQUE,
            document_type VARCHAR NOT NULL,
            source_request_id VARCHAR NOT NULL UNIQUE,
            status VARCHAR NOT NULL DEFAULT 'draft',
            requester_name VARCHAR NOT NULL,
            company_name VARCHAR NOT NULL DEFAULT '',
            customer_id VARCHAR NOT NULL DEFAULT '',
            project_name VARCHAR NOT NULL,
            project_location TEXT NOT NULL DEFAULT '',
            delivery_location TEXT NOT NULL DEFAULT '',
            required_delivery_date VARCHAR NOT NULL DEFAULT '',
            priority VARCHAR NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            created_by VARCHAR NOT NULL DEFAULT '',
            created_at VARCHAR NOT NULL,
            FOREIGN KEY(source_request_id) REFERENCES incoming_purchase_requests(id)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS internal_purchase_document_items (
            id VARCHAR PRIMARY KEY,
            document_id VARCHAR NOT NULL,
            source_request_item_id VARCHAR NOT NULL,
            position INTEGER NOT NULL,
            product_name VARCHAR NOT NULL,
            preferred_brand VARCHAR NOT NULL DEFAULT '',
            main_category VARCHAR NOT NULL DEFAULT '',
            subcategory VARCHAR NOT NULL DEFAULT '',
            specifications TEXT NOT NULL DEFAULT '',
            quantity FLOAT NOT NULL,
            unit VARCHAR NOT NULL,
            FOREIGN KEY(document_id) REFERENCES internal_purchase_documents(id) ON DELETE CASCADE,
            FOREIGN KEY(source_request_item_id) REFERENCES incoming_purchase_request_items(id),
            UNIQUE(document_id, position)
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_incoming_requests_number ON incoming_purchase_requests(request_number)",
        "CREATE INDEX IF NOT EXISTS ix_incoming_requests_status ON incoming_purchase_requests(status)",
        "CREATE INDEX IF NOT EXISTS ix_incoming_requests_priority ON incoming_purchase_requests(priority)",
        "CREATE INDEX IF NOT EXISTS ix_incoming_requests_created_at ON incoming_purchase_requests(created_at)",
        "CREATE INDEX IF NOT EXISTS ix_incoming_requests_fingerprint ON incoming_purchase_requests(content_fingerprint)",
        "CREATE INDEX IF NOT EXISTS ix_incoming_request_items_request ON incoming_purchase_request_items(request_id)",
        "CREATE INDEX IF NOT EXISTS ix_incoming_status_request ON incoming_request_status_history(request_id)",
        "CREATE INDEX IF NOT EXISTS ix_incoming_notes_request ON incoming_request_internal_notes(request_id)",
        "CREATE INDEX IF NOT EXISTS ix_internal_notifications_unread ON internal_notifications(is_read, created_at)",
    ]
    with engine.begin() as connection:
        for statement in statements:
            connection.exec_driver_sql(statement)
        connection.exec_driver_sql(
            f"PRAGMA user_version = {INCOMING_REQUESTS_SCHEMA_VERSION}"
        )
    return backup_path


def migrate_purchase_request_item_review(engine) -> Path | None:
    """Adopt all item-review columns expected by the current ORM model."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "incoming_purchase_request_items" not in tables:
        return None
    columns = {column["name"] for column in inspector.get_columns("incoming_purchase_request_items")}
    definitions = {
        "review_status": "VARCHAR NOT NULL DEFAULT 'pending'",
        "review_reason": "TEXT NOT NULL DEFAULT ''",
        "reviewed_by": "VARCHAR NOT NULL DEFAULT ''",
        "reviewed_at": "VARCHAR NOT NULL DEFAULT ''",
        "hold_since": "VARCHAR NOT NULL DEFAULT ''",
        "approved_unit_price": "FLOAT NOT NULL DEFAULT 0",
        "approved_price_note": "TEXT NOT NULL DEFAULT ''",
    }
    missing = set(definitions) - columns
    if not missing:
        return None
    database_path = _database_path(engine)
    if database_path is None:
        raise RuntimeError("A file-backed SQLite database is required for safe migration")
    backup_path = create_verified_backup(database_path, label="purchase-request-item-review")
    with engine.begin() as connection:
        for name in sorted(missing):
            connection.exec_driver_sql(
                f"ALTER TABLE incoming_purchase_request_items ADD COLUMN {name} {definitions[name]}"
            )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_incoming_purchase_request_items_review_status "
            "ON incoming_purchase_request_items(review_status)"
        )
    return backup_path


def migrate_business_code_sequences(engine) -> Path | None:
    """Add durable master-data counters without changing existing business codes."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.connect() as connection:
        current_version = connection.exec_driver_sql("PRAGMA user_version").scalar_one()
    if (
        "business_code_sequences" in existing_tables
        and current_version >= BUSINESS_CODE_SCHEMA_VERSION
    ):
        return None

    database_path = _database_path(engine)
    backup_path = None
    operational_tables = {"suppliers", "customers", "projects", "items"}
    if existing_tables & operational_tables:
        if database_path is None:
            raise RuntimeError("A file-backed SQLite database is required for safe migration")
        backup_path = create_verified_backup(database_path, label="business-code-sequences")

    with engine.begin() as connection:
        connection.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS business_code_sequences (
                entity VARCHAR PRIMARY KEY,
                next_value INTEGER NOT NULL CHECK (next_value > 0)
            )
            """
        )
        connection.exec_driver_sql(
            f"PRAGMA user_version = {BUSINESS_CODE_SCHEMA_VERSION}"
        )
    return backup_path


def migrate_supplier_price_comparisons(engine) -> Path | None:
    """Create the isolated supplier price-comparison tables without touching legacy rows."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    required_tables = {"price_comparisons", "price_comparison_rows"}
    comparison_columns = (
        {column["name"] for column in inspector.get_columns("price_comparisons")}
        if "price_comparisons" in existing_tables else set()
    )
    required_comparison_columns = {"source_request_id", "source_request_number"}
    row_columns = (
        {column["name"] for column in inspector.get_columns("price_comparison_rows")}
        if "price_comparison_rows" in existing_tables else set()
    )
    required_row_columns = {
        "main_category", "subcategory", "specifications", "selected_for_purchase",
    }
    with engine.connect() as connection:
        current_version = connection.exec_driver_sql("PRAGMA user_version").scalar_one()
    if (
        required_tables.issubset(existing_tables)
        and required_comparison_columns.issubset(comparison_columns)
        and required_row_columns.issubset(row_columns)
        and current_version >= SUPPLIER_PRICE_COMPARISON_SCHEMA_VERSION
    ):
        return None

    database_path = _database_path(engine)
    backup_path = None
    if existing_tables & {"suppliers", "customers", "projects", "items"}:
        if database_path is None:
            raise RuntimeError("A file-backed SQLite database is required for safe migration")
        backup_path = create_verified_backup(database_path, label="supplier-price-comparisons")

    statements = [
        """
        CREATE TABLE IF NOT EXISTS price_comparisons (
            id VARCHAR PRIMARY KEY,
            comparison_number VARCHAR NOT NULL UNIQUE,
            project_id VARCHAR NULL,
            project_name VARCHAR NOT NULL DEFAULT '',
            customer_id VARCHAR NULL,
            customer_name VARCHAR NOT NULL DEFAULT '',
            source_request_id VARCHAR NOT NULL DEFAULT '',
            source_request_number VARCHAR NOT NULL DEFAULT '',
            comparison_date VARCHAR NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            created_at VARCHAR NOT NULL,
            updated_at VARCHAR NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL,
            FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS price_comparison_rows (
            id VARCHAR PRIMARY KEY,
            comparison_id VARCHAR NOT NULL,
            position INTEGER NOT NULL,
            item_id VARCHAR NULL,
            item_code VARCHAR NOT NULL,
            product_name VARCHAR NOT NULL,
            brand VARCHAR NOT NULL DEFAULT '',
            main_category VARCHAR NOT NULL DEFAULT '',
            subcategory VARCHAR NOT NULL DEFAULT '',
            specifications TEXT NOT NULL DEFAULT '',
            unit VARCHAR NOT NULL DEFAULT '',
            supplier_id VARCHAR NULL,
            supplier_code VARCHAR NOT NULL,
            supplier_name VARCHAR NOT NULL,
            quantity FLOAT NOT NULL,
            unit_price FLOAT NOT NULL DEFAULT 0,
            discount_pct FLOAT NOT NULL DEFAULT 0,
            tax_pct FLOAT NOT NULL DEFAULT 0,
            shipping_cost FLOAT NOT NULL DEFAULT 0,
            other_cost FLOAT NOT NULL DEFAULT 0,
            delivery_days INTEGER NOT NULL DEFAULT 0,
            payment_terms VARCHAR NOT NULL DEFAULT '',
            availability VARCHAR NOT NULL DEFAULT 'available',
            price_valid_until VARCHAR NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            selected_for_purchase INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(comparison_id) REFERENCES price_comparisons(id) ON DELETE CASCADE,
            FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE SET NULL,
            FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
            UNIQUE(comparison_id, item_id, supplier_id)
        )
        """,
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_price_comparisons_number ON price_comparisons(comparison_number)",
        "CREATE INDEX IF NOT EXISTS ix_price_comparisons_date ON price_comparisons(comparison_date)",
        "CREATE INDEX IF NOT EXISTS ix_price_comparisons_project ON price_comparisons(project_id)",
        "CREATE INDEX IF NOT EXISTS ix_price_comparisons_customer ON price_comparisons(customer_id)",
        "CREATE INDEX IF NOT EXISTS ix_price_comparisons_updated ON price_comparisons(updated_at)",
        "CREATE INDEX IF NOT EXISTS ix_price_comparison_rows_comparison ON price_comparison_rows(comparison_id)",
        "CREATE INDEX IF NOT EXISTS ix_price_comparison_rows_item ON price_comparison_rows(item_id)",
        "CREATE INDEX IF NOT EXISTS ix_price_comparison_rows_supplier ON price_comparison_rows(supplier_id)",
        "CREATE INDEX IF NOT EXISTS ix_price_comparison_rows_availability ON price_comparison_rows(availability)",
        "CREATE INDEX IF NOT EXISTS ix_price_comparison_rows_item_supplier ON price_comparison_rows(item_id, supplier_id)",
        "CREATE INDEX IF NOT EXISTS ix_price_comparison_rows_product_name ON price_comparison_rows(product_name)",
        "CREATE INDEX IF NOT EXISTS ix_price_comparison_rows_supplier_name ON price_comparison_rows(supplier_name)",
        "CREATE INDEX IF NOT EXISTS ix_price_comparison_rows_comparison_position ON price_comparison_rows(comparison_id, position)",
    ]
    with engine.begin() as connection:
        for statement in statements:
            connection.exec_driver_sql(statement)
        comparison_columns = {
            row[1] for row in connection.exec_driver_sql(
                "PRAGMA table_info(price_comparisons)"
            ).fetchall()
        }
        for column in ("source_request_id", "source_request_number"):
            if column not in comparison_columns:
                connection.exec_driver_sql(
                    f"ALTER TABLE price_comparisons ADD COLUMN {column} "
                    "VARCHAR NOT NULL DEFAULT ''"
                )
        row_columns = {
            row[1] for row in connection.exec_driver_sql(
                "PRAGMA table_info(price_comparison_rows)"
            ).fetchall()
        }
        for column, definition in {
            "main_category": "VARCHAR NOT NULL DEFAULT ''",
            "subcategory": "VARCHAR NOT NULL DEFAULT ''",
            "specifications": "TEXT NOT NULL DEFAULT ''",
            "selected_for_purchase": "INTEGER NOT NULL DEFAULT 0",
        }.items():
            if column not in row_columns:
                connection.exec_driver_sql(
                    f"ALTER TABLE price_comparison_rows ADD COLUMN {column} {definition}"
                )
        connection.exec_driver_sql(
            f"PRAGMA user_version = {SUPPLIER_PRICE_COMPARISON_SCHEMA_VERSION}"
        )
    return backup_path


def migrate_document_capture(engine) -> Path | None:
    """Add multilingual item identity and isolated document-review tables."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    required_tables = {
        "purchase_request_documents", "purchase_request_document_files",
        "purchase_request_extracted_items", "purchase_request_item_candidates",
        "document_processing_jobs", "purchase_request_audit_events",
        "item_master_creation_requests",
    }
    item_columns = (
        {column["name"] for column in inspector.get_columns("items")}
        if "items" in tables else set()
    )
    required_item_columns = {"name_ar", "name_en", "alternative_names", "search_aliases"}
    with engine.connect() as connection:
        current_version = connection.exec_driver_sql("PRAGMA user_version").scalar_one()
    if (
        required_tables.issubset(tables)
        and required_item_columns.issubset(item_columns)
        and current_version >= DOCUMENT_CAPTURE_SCHEMA_VERSION
    ):
        return None

    database_path = _database_path(engine)
    backup_path = None
    if tables:
        if database_path is None:
            raise RuntimeError("A file-backed SQLite database is required for safe migration")
        backup_path = create_verified_backup(database_path, label="document-capture")

    if "items" in tables:
        with engine.begin() as connection:
            for name, definition in {
                "name_ar": "VARCHAR NOT NULL DEFAULT ''",
                "name_en": "VARCHAR NOT NULL DEFAULT ''",
                "alternative_names": "JSON NOT NULL DEFAULT '[]'",
                "search_aliases": "JSON NOT NULL DEFAULT '[]'",
            }.items():
                if name not in item_columns:
                    connection.exec_driver_sql(f"ALTER TABLE items ADD COLUMN {name} {definition}")
            connection.execute(text(
                "UPDATE items SET name_ar = COALESCE(NULLIF(TRIM(name_ar), ''), "
                "NULLIF(TRIM(product_name), ''), name)"
            ))
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_items_name_ar ON items(name_ar)")
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_items_name_en ON items(name_en)")

    # Imported lazily after the database module is initialized to avoid a cycle.
    try:
        from .document_capture import models as _document_models  # noqa: F401
        from .database import Base
    except ImportError:  # pragma: no cover
        from document_capture import models as _document_models  # noqa: F401
        from database import Base
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql(f"PRAGMA user_version = {DOCUMENT_CAPTURE_SCHEMA_VERSION}")
    return backup_path


def migrate_guided_procurement_workflow(engine) -> Path | None:
    """Add request/PO traceability columns before ORM table creation.

    Approval, payment, and audit tables are created by SQLAlchemy metadata after
    this guarded adoption step. Existing business rows are never rewritten.
    """
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    request_columns = (
        {column["name"] for column in inspector.get_columns("incoming_purchase_requests")}
        if "incoming_purchase_requests" in tables else set()
    )
    po_columns = (
        {column["name"] for column in inspector.get_columns("purchase_orders")}
        if "purchase_orders" in tables else set()
    )
    approval_columns = (
        {column["name"] for column in inspector.get_columns("engineer_approvals")}
        if "engineer_approvals" in tables else set()
    )
    required_request = {"project_id", "customer_id", "customer_name"}
    required_po = {"source_request_id", "source_request_number", "approval_id", "approval_number"}
    required_approval = {"approval_type", "approval_stage", "responsible_role"}
    with engine.connect() as connection:
        current_version = connection.exec_driver_sql("PRAGMA user_version").scalar_one()
    if (
        required_request.issubset(request_columns)
        and required_po.issubset(po_columns)
        and ("engineer_approvals" not in tables or required_approval.issubset(approval_columns))
        and current_version >= GUIDED_PROCUREMENT_SCHEMA_VERSION
    ):
        return None

    database_path = _database_path(engine)
    backup_path = None
    if tables:
        if database_path is None:
            raise RuntimeError("A file-backed SQLite database is required for safe migration")
        backup_path = create_verified_backup(database_path, label="guided-procurement-workflow")

    with engine.begin() as connection:
        if "incoming_purchase_requests" in tables:
            for name in sorted(required_request - request_columns):
                connection.exec_driver_sql(
                    f"ALTER TABLE incoming_purchase_requests ADD COLUMN {name} "
                    "VARCHAR NOT NULL DEFAULT ''"
                )
            connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_incoming_purchase_requests_project_id "
                "ON incoming_purchase_requests(project_id)"
            )
            connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_incoming_purchase_requests_customer_id "
                "ON incoming_purchase_requests(customer_id)"
            )
        if "purchase_orders" in tables:
            for name in sorted(required_po - po_columns):
                connection.exec_driver_sql(
                    f"ALTER TABLE purchase_orders ADD COLUMN {name} VARCHAR NOT NULL DEFAULT ''"
                )
            connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_purchase_orders_source_request_id "
                "ON purchase_orders(source_request_id)"
            )
            connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_purchase_orders_approval_id "
                "ON purchase_orders(approval_id)"
            )
        if "engineer_approvals" in tables:
            approval_definitions = {
                "approval_type": "VARCHAR NOT NULL DEFAULT 'external_engineer'",
                "approval_stage": "VARCHAR NOT NULL DEFAULT 'external_review'",
                "responsible_role": "VARCHAR NOT NULL DEFAULT 'external_engineer'",
            }
            for name in sorted(required_approval - approval_columns):
                connection.exec_driver_sql(
                    f"ALTER TABLE engineer_approvals ADD COLUMN {name} "
                    f"{approval_definitions[name]}"
                )
        connection.exec_driver_sql(
            f"PRAGMA user_version = {GUIDED_PROCUREMENT_SCHEMA_VERSION}"
        )
    return backup_path


def migrate_site_receiving(engine) -> Path | None:
    """Add append-only PO receipt events without changing existing business rows."""
    required_tables = {"purchase_order_receipts", "purchase_order_receipt_lines"}
    tables = set(inspect(engine).get_table_names())
    with engine.connect() as connection:
        current_version = connection.exec_driver_sql("PRAGMA user_version").scalar_one()
    if required_tables.issubset(tables) and current_version >= SITE_RECEIVING_SCHEMA_VERSION:
        return None

    database_path = _database_path(engine)
    backup_path = None
    if tables:
        if database_path is None:
            raise RuntimeError("A file-backed SQLite database is required for safe migration")
        backup_path = create_verified_backup(database_path, label="site-receiving")

    with engine.begin() as connection:
        connection.exec_driver_sql("""
            CREATE TABLE IF NOT EXISTS purchase_order_receipts (
                id VARCHAR PRIMARY KEY,
                purchase_order_id VARCHAR NOT NULL,
                idempotency_key VARCHAR NOT NULL,
                receipt_type VARCHAR NOT NULL,
                actor_role VARCHAR NOT NULL DEFAULT 'procurement_officer',
                actor_name VARCHAR NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                problem_reason VARCHAR NOT NULL DEFAULT '',
                affected_item_id VARCHAR NOT NULL DEFAULT '',
                affected_quantity FLOAT NOT NULL DEFAULT 0,
                po_number VARCHAR NOT NULL DEFAULT '',
                project_name VARCHAR NOT NULL DEFAULT '',
                supplier_name VARCHAR NOT NULL DEFAULT '',
                received_at VARCHAR NOT NULL,
                CONSTRAINT uq_po_receipt_idempotency UNIQUE (purchase_order_id, idempotency_key),
                FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
            )
        """)
        connection.exec_driver_sql("""
            CREATE TABLE IF NOT EXISTS purchase_order_receipt_lines (
                id VARCHAR PRIMARY KEY,
                receipt_id VARCHAR NOT NULL,
                purchase_order_item_id VARCHAR NOT NULL,
                item_code VARCHAR NOT NULL DEFAULT '',
                product_name VARCHAR NOT NULL DEFAULT '',
                unit VARCHAR NOT NULL DEFAULT '',
                ordered_quantity FLOAT NOT NULL,
                previously_received_quantity FLOAT NOT NULL DEFAULT 0,
                received_quantity FLOAT NOT NULL DEFAULT 0,
                remaining_quantity FLOAT NOT NULL DEFAULT 0,
                CONSTRAINT uq_po_receipt_line_item UNIQUE (receipt_id, purchase_order_item_id),
                FOREIGN KEY(receipt_id) REFERENCES purchase_order_receipts(id) ON DELETE CASCADE,
                FOREIGN KEY(purchase_order_item_id) REFERENCES purchase_order_items(id) ON DELETE RESTRICT
            )
        """)
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_po_receipts_order ON purchase_order_receipts(purchase_order_id)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_po_receipts_received_at ON purchase_order_receipts(received_at)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_po_receipt_lines_receipt ON purchase_order_receipt_lines(receipt_id)"
        )
        connection.exec_driver_sql(
            f"PRAGMA user_version = {SITE_RECEIVING_SCHEMA_VERSION}"
        )
    return backup_path


def migrate_construction_calculator(engine) -> Path | None:
    """Add isolated construction-calculator tables after a verified backup."""
    required_tables = {
        "construction_import_runs",
        "construction_import_issues",
        "construction_categories",
        "construction_work_items",
        "construction_materials",
        "construction_labor_roles",
        "construction_equipment",
        "construction_work_crews",
        "construction_crew_labor_members",
        "construction_crew_equipment",
        "construction_material_rates",
        "construction_productivity_rates",
        "construction_work_item_adjustments",
        "construction_market_aliases",
        "construction_calculation_sessions",
        "construction_calculation_material_results",
        "construction_calculation_labor_results",
        "construction_calculation_equipment_results",
        "construction_calculation_snapshots",
        "construction_purchase_request_links",
        "construction_purchase_request_item_links",
    }
    tables = set(inspect(engine).get_table_names())
    with engine.connect() as connection:
        current_version = connection.exec_driver_sql("PRAGMA user_version").scalar_one()
    if required_tables.issubset(tables) and current_version >= CONSTRUCTION_CALCULATOR_SCHEMA_VERSION:
        return None
    database_path = _database_path(engine)
    backup_path = None
    if tables:
        if database_path is None:
            raise RuntimeError("A file-backed SQLite database is required for safe migration")
        backup_path = create_verified_backup(database_path, label="construction-calculator")
    try:
        from .construction_calculator import models as _construction_models  # noqa: F401
        from . import incoming_requests as _incoming_requests  # noqa: F401
        from .database import Base
    except ImportError:  # pragma: no cover
        from construction_calculator import models as _construction_models  # noqa: F401
        import incoming_requests as _incoming_requests  # noqa: F401
        from database import Base
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            f"PRAGMA user_version = {CONSTRUCTION_CALCULATOR_SCHEMA_VERSION}"
        )
    return backup_path


def migrate_site_portal_requests(engine) -> Path | None:
    """Add requester/project/delivery-destination and item-link columns to the
    existing incoming-request tables so Site Portal submissions can be traced
    to an authenticated user and a real Item Master row, without altering the
    existing anonymous public-intake columns or any Supplier/Item data."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "incoming_purchase_requests" not in tables:
        return None
    request_columns = {column["name"] for column in inspector.get_columns("incoming_purchase_requests")}
    request_definitions = {
        "requester_user_id": "VARCHAR NOT NULL DEFAULT ''",
        "delivery_destination": "VARCHAR NOT NULL DEFAULT ''",
        "source_request_id": "VARCHAR NOT NULL DEFAULT ''",
        "source_item_id": "VARCHAR NOT NULL DEFAULT ''",
    }
    item_columns = (
        {column["name"] for column in inspector.get_columns("incoming_purchase_request_items")}
        if "incoming_purchase_request_items" in tables else set()
    )
    item_definitions = {"item_id": "VARCHAR NOT NULL DEFAULT ''"}

    missing_request_columns = set(request_definitions) - request_columns
    missing_item_columns = set(item_definitions) - item_columns
    if not missing_request_columns and not missing_item_columns:
        return None

    database_path = _database_path(engine)
    if database_path is None:
        raise RuntimeError("A file-backed SQLite database is required for safe migration")
    backup_path = create_verified_backup(database_path, label="site-portal-requests")

    with engine.begin() as connection:
        for name in sorted(missing_request_columns):
            connection.exec_driver_sql(
                f"ALTER TABLE incoming_purchase_requests ADD COLUMN {name} {request_definitions[name]}"
            )
        if missing_request_columns:
            connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_incoming_purchase_requests_requester_user_id "
                "ON incoming_purchase_requests(requester_user_id)"
            )
            connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_incoming_purchase_requests_source_request_id "
                "ON incoming_purchase_requests(source_request_id)"
            )
            connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_incoming_purchase_requests_source_item_id "
                "ON incoming_purchase_requests(source_item_id)"
            )
        for name in sorted(missing_item_columns):
            connection.exec_driver_sql(
                f"ALTER TABLE incoming_purchase_request_items ADD COLUMN {name} {item_definitions[name]}"
            )
        if missing_item_columns:
            connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_incoming_purchase_request_items_item_id "
                "ON incoming_purchase_request_items(item_id)"
            )
        connection.exec_driver_sql(
            f"PRAGMA user_version = {SITE_PORTAL_REQUESTS_SCHEMA_VERSION}"
        )
    return backup_path


def migrate_authentication(engine) -> Path | None:
    """Add the users and user_project_access tables after a verified backup."""
    required_tables = {"users", "user_project_access"}
    tables = set(inspect(engine).get_table_names())
    with engine.connect() as connection:
        current_version = connection.exec_driver_sql("PRAGMA user_version").scalar_one()
    if required_tables.issubset(tables) and current_version >= AUTHENTICATION_SCHEMA_VERSION:
        return None
    database_path = _database_path(engine)
    backup_path = None
    if tables:
        if database_path is None:
            raise RuntimeError("A file-backed SQLite database is required for safe migration")
        backup_path = create_verified_backup(database_path, label="authentication")
    try:
        from .auth import models as _auth_models  # noqa: F401
        from .database import Base
    except ImportError:  # pragma: no cover
        from auth import models as _auth_models  # noqa: F401
        from database import Base
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            f"PRAGMA user_version = {AUTHENTICATION_SCHEMA_VERSION}"
        )
    return backup_path


def migrate_site_portal_attachments(engine) -> Path | None:
    """Add incoming_request_general_attachments (request-level, multiple per
    request) after a verified backup. A new table rather than a change to
    the existing incoming_request_attachments, which is one-file-per-item
    (request_item_id is NOT NULL + UNIQUE there) and used by the anonymous
    public-intake flow — left untouched."""
    required_tables = {"incoming_request_general_attachments"}
    tables = set(inspect(engine).get_table_names())
    with engine.connect() as connection:
        current_version = connection.exec_driver_sql("PRAGMA user_version").scalar_one()
    if required_tables.issubset(tables) and current_version >= SITE_PORTAL_ATTACHMENTS_SCHEMA_VERSION:
        return None
    database_path = _database_path(engine)
    backup_path = None
    if tables:
        if database_path is None:
            raise RuntimeError("A file-backed SQLite database is required for safe migration")
        backup_path = create_verified_backup(database_path, label="site-portal-attachments")
    try:
        from . import incoming_requests as _incoming_requests  # noqa: F401
        from .database import Base
    except ImportError:  # pragma: no cover
        import incoming_requests as _incoming_requests  # noqa: F401
        from database import Base
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            f"PRAGMA user_version = {SITE_PORTAL_ATTACHMENTS_SCHEMA_VERSION}"
        )
    return backup_path


def migrate_rfq_supplier_quotations(engine) -> Path | None:
    """Add the isolated RFQ / supplier-quotation tables after a verified
    backup. Brand-new, additive tables only - no existing rows are touched."""
    required_tables = {
        "rfqs", "rfq_items", "rfq_suppliers", "supplier_quotations",
        "supplier_quotation_lines", "supplier_quotation_attachments",
    }
    tables = set(inspect(engine).get_table_names())
    with engine.connect() as connection:
        current_version = connection.exec_driver_sql("PRAGMA user_version").scalar_one()
    if required_tables.issubset(tables) and current_version >= RFQ_SUPPLIER_QUOTATIONS_SCHEMA_VERSION:
        return None
    database_path = _database_path(engine)
    backup_path = None
    if tables:
        if database_path is None:
            raise RuntimeError("A file-backed SQLite database is required for safe migration")
        backup_path = create_verified_backup(database_path, label="rfq-supplier-quotations")
    try:
        from . import rfq as _rfq  # noqa: F401
        from .database import Base
    except ImportError:  # pragma: no cover
        import rfq as _rfq  # noqa: F401
        from database import Base
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            f"PRAGMA user_version = {RFQ_SUPPLIER_QUOTATIONS_SCHEMA_VERSION}"
        )
    return backup_path


def migrate_po_payment_ledger(engine) -> Path | None:
    """Add the purchase_order_payments table after a verified backup.
    Brand-new, additive table only - no existing purchase_orders rows are
    touched (credit_days/payment_due_date reuse the existing extra_data
    JSON column already on purchase_orders, so no ALTER is needed there)."""
    required_tables = {"purchase_order_payments"}
    tables = set(inspect(engine).get_table_names())
    with engine.connect() as connection:
        current_version = connection.exec_driver_sql("PRAGMA user_version").scalar_one()
    if required_tables.issubset(tables) and current_version >= PO_PAYMENT_LEDGER_SCHEMA_VERSION:
        return None
    database_path = _database_path(engine)
    backup_path = None
    if tables:
        if database_path is None:
            raise RuntimeError("A file-backed SQLite database is required for safe migration")
        backup_path = create_verified_backup(database_path, label="po-payment-ledger")
    try:
        from .database import Base
    except ImportError:  # pragma: no cover
        from database import Base
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            f"PRAGMA user_version = {PO_PAYMENT_LEDGER_SCHEMA_VERSION}"
        )
    return backup_path


def migrate_supplier_offer_adjustments(engine) -> Path | None:
    """Add supplier-offer adjustments and preserve effective legacy totals."""
    required_tables = {
        "price_comparison_supplier_offers", "engineer_approval_supplier_offers",
    }
    tables = set(inspect(engine).get_table_names())
    with engine.connect() as connection:
        current_version = connection.exec_driver_sql("PRAGMA user_version").scalar_one()
    if required_tables.issubset(tables) and current_version >= SUPPLIER_OFFER_ADJUSTMENTS_SCHEMA_VERSION:
        return None
    database_path = _database_path(engine)
    backup_path = None
    if tables:
        if database_path is None:
            raise RuntimeError("A file-backed SQLite database is required for safe migration")
        backup_path = create_verified_backup(database_path, label="supplier-offer-adjustments")
    try:
        from . import price_comparisons as _price_comparisons  # noqa: F401
        from .database import Base
    except ImportError:  # pragma: no cover
        import price_comparisons as _price_comparisons  # noqa: F401
        from database import Base
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        if {"price_comparisons", "price_comparison_rows"}.issubset(tables):
            comparisons = {
                row["id"]: row["comparison_date"]
                for row in connection.exec_driver_sql(
                    "SELECT id, comparison_date FROM price_comparisons"
                ).mappings()
            }
            rows = connection.exec_driver_sql(
                "SELECT * FROM price_comparison_rows ORDER BY comparison_id, position"
            ).mappings().all()
            groups = {}
            for row in rows:
                supplier_code = str(row.get("supplier_code") or "")
                if supplier_code:
                    groups.setdefault((row["comparison_id"], supplier_code), []).append(row)
            for (comparison_id, supplier_code), group_rows in groups.items():
                exists = connection.exec_driver_sql(
                    "SELECT 1 FROM price_comparison_supplier_offers "
                    "WHERE comparison_id = ? AND supplier_code = ?",
                    (comparison_id, supplier_code),
                ).first()
                if exists:
                    continue
                comparison_date = comparisons.get(comparison_id, "")
                eligible = [row for row in group_rows if (
                    float(row.get("quantity") or 0) > 0
                    and float(row.get("unit_price") or 0) > 0
                    and row.get("availability") == "available"
                    and not (row.get("price_valid_until") and row["price_valid_until"] < comparison_date)
                )]
                subtotal = sum(float(row["quantity"]) * float(row["unit_price"]) for row in eligible)
                discount = sum(
                    float(row["quantity"]) * float(row["unit_price"])
                    * float(row.get("discount_pct") or 0) / 100 for row in eligible
                )
                taxable = subtotal - discount
                vat = sum(
                    float(row["quantity"]) * float(row["unit_price"])
                    * (1 - float(row.get("discount_pct") or 0) / 100)
                    * float(row.get("tax_pct") or 0) / 100 for row in eligible
                )
                first = group_rows[0]
                connection.exec_driver_sql(
                    "INSERT INTO price_comparison_supplier_offers "
                    "(id, comparison_id, supplier_id, supplier_code, supplier_name, "
                    "discount_pct, tax_pct, shipping_cost, other_cost) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        f"{comparison_id}:{supplier_code}", comparison_id,
                        first.get("supplier_id"), supplier_code,
                        first.get("supplier_name") or "",
                        discount / subtotal * 100 if subtotal else 0,
                        vat / taxable * 100 if taxable else 0,
                        sum(float(row.get("shipping_cost") or 0) for row in eligible),
                        sum(float(row.get("other_cost") or 0) for row in eligible),
                    ),
                )
        connection.exec_driver_sql(
            f"PRAGMA user_version = {SUPPLIER_OFFER_ADJUSTMENTS_SCHEMA_VERSION}"
        )
    return backup_path


def migrate_daily_reports(engine) -> Path | None:
    """Add the daily_reports table (manual notes + close marker) after a
    verified backup. Brand-new, additive table only - no existing rows in
    any other table are touched."""
    required_tables = {"daily_reports"}
    tables = set(inspect(engine).get_table_names())
    with engine.connect() as connection:
        current_version = connection.exec_driver_sql("PRAGMA user_version").scalar_one()
    if required_tables.issubset(tables) and current_version >= DAILY_REPORT_SCHEMA_VERSION:
        return None
    database_path = _database_path(engine)
    backup_path = None
    if tables:
        if database_path is None:
            raise RuntimeError("A file-backed SQLite database is required for safe migration")
        backup_path = create_verified_backup(database_path, label="daily-reports")
    try:
        from . import daily_report as _daily_report  # noqa: F401
        from .database import Base
    except ImportError:  # pragma: no cover
        import daily_report as _daily_report  # noqa: F401
        from database import Base
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            f"PRAGMA user_version = {DAILY_REPORT_SCHEMA_VERSION}"
        )
    return backup_path


def migrate_whatsapp_intake(engine) -> Path | None:
    """Add users.phone_e164 plus the whatsapp_drafts / whatsapp_processed_messages
    tables after a verified backup. Additive only: no existing users/incoming
    request rows are touched."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "users" not in tables:
        return None
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    required_tables = {"whatsapp_drafts", "whatsapp_processed_messages"}
    with engine.connect() as connection:
        current_version = connection.exec_driver_sql("PRAGMA user_version").scalar_one()
    if (
        "phone_e164" in user_columns
        and required_tables.issubset(tables)
        and current_version >= WHATSAPP_INTAKE_SCHEMA_VERSION
    ):
        return None

    database_path = _database_path(engine)
    if database_path is None:
        raise RuntimeError("A file-backed SQLite database is required for safe migration")
    backup_path = create_verified_backup(database_path, label="whatsapp-intake")

    with engine.begin() as connection:
        if "phone_e164" not in user_columns:
            connection.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN phone_e164 VARCHAR NOT NULL DEFAULT ''"
            )
    try:
        from .whatsapp import models as _whatsapp_models  # noqa: F401
        from .database import Base
    except ImportError:  # pragma: no cover
        from whatsapp import models as _whatsapp_models  # noqa: F401
        from database import Base
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            f"PRAGMA user_version = {WHATSAPP_INTAKE_SCHEMA_VERSION}"
        )
    return backup_path


def migrate_whatsapp_settings_and_source(engine) -> Path | None:
    """Add incoming_purchase_requests.source (intake channel, for the list
    badge) and the whatsapp_settings singleton table (Admin on/off toggle +
    last-known connection/webhook state) after a verified backup."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "incoming_purchase_requests" not in tables:
        return None
    request_columns = {column["name"] for column in inspector.get_columns("incoming_purchase_requests")}
    required_tables = {"whatsapp_settings"}
    with engine.connect() as connection:
        current_version = connection.exec_driver_sql("PRAGMA user_version").scalar_one()
    if (
        "source" in request_columns
        and required_tables.issubset(tables)
        and current_version >= WHATSAPP_SETTINGS_SCHEMA_VERSION
    ):
        return None

    database_path = _database_path(engine)
    if database_path is None:
        raise RuntimeError("A file-backed SQLite database is required for safe migration")
    backup_path = create_verified_backup(database_path, label="whatsapp-settings-and-source")

    with engine.begin() as connection:
        if "source" not in request_columns:
            connection.exec_driver_sql(
                "ALTER TABLE incoming_purchase_requests ADD COLUMN source VARCHAR NOT NULL DEFAULT ''"
            )
            connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_incoming_purchase_requests_source "
                "ON incoming_purchase_requests(source)"
            )
    try:
        from .whatsapp import models as _whatsapp_models  # noqa: F401
        from .database import Base
    except ImportError:  # pragma: no cover
        from whatsapp import models as _whatsapp_models  # noqa: F401
        from database import Base
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            f"PRAGMA user_version = {WHATSAPP_SETTINGS_SCHEMA_VERSION}"
        )
    return backup_path


def _main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    parser.add_argument("--backup-only", action="store_true")
    args = parser.parse_args()
    if not args.backup_only:
        parser.error("Only --backup-only is supported by this utility entry point")
    print(create_verified_backup(args.database))


if __name__ == "__main__":
    _main()
