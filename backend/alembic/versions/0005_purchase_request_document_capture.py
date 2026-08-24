"""Add reviewed document capture and multilingual item matching.

Revision ID: 0005_purchase_request_document_capture
Revises: 0004_price_comparison_manual_entry
"""

import sqlalchemy as sa
from alembic import op

from document_capture.models import (
    DocumentFile,
    DocumentProcessingJob,
    ExtractedItem,
    ItemCandidate,
    ItemMasterCreationRequest,
    PurchaseRequestDocument,
    RequestAuditEvent,
)
from schema_contract import (
    reconcile_non_sqlite_connection,
    reconcile_sqlite_connection,
)


revision = "0005_purchase_request_document_capture"
down_revision = "0004_price_comparison_manual_entry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    item_columns = {column["name"] for column in inspector.get_columns("items")}
    for name, column_type, default in (
        ("name_ar", sa.String(), ""),
        ("name_en", sa.String(), ""),
        ("alternative_names", sa.JSON(), "[]"),
        ("search_aliases", sa.JSON(), "[]"),
    ):
        if name not in item_columns:
            op.add_column(
                "items",
                sa.Column(name, column_type, nullable=False, server_default=default),
            )
    op.execute(
        "UPDATE items SET name_ar = COALESCE(NULLIF(TRIM(name_ar), ''), "
        "NULLIF(TRIM(product_name), ''), name)"
    )
    inspector = sa.inspect(bind)
    indexes = {index["name"] for index in inspector.get_indexes("items")}
    if "ix_items_name_ar" not in indexes:
        op.create_index("ix_items_name_ar", "items", ["name_ar"])
    if "ix_items_name_en" not in indexes:
        op.create_index("ix_items_name_en", "items", ["name_en"])
    for table in (
        PurchaseRequestDocument.__table__,
        DocumentFile.__table__,
        ExtractedItem.__table__,
        ItemCandidate.__table__,
        DocumentProcessingJob.__table__,
        RequestAuditEvent.__table__,
        ItemMasterCreationRequest.__table__,
    ):
        table.create(bind, checkfirst=True)

    # The legacy SQLite bootstrap correctly supplied database-level defaults,
    # while the ORM-created 0001 tables supplied Python defaults only.  Reconcile
    # metadata without updating any existing row values.
    if bind.dialect.name == "sqlite":
        reconcile_sqlite_connection(bind)
    else:
        reconcile_non_sqlite_connection(bind)


def downgrade() -> None:
    raise RuntimeError(
        "Destructive downgrade is disabled. Restore the verified pre-migration backup instead."
    )
