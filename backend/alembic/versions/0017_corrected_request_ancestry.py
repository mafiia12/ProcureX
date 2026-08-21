"""Add traceable ancestry for corrected Site Portal request items.

Revision ID: 0017_corrected_request_ancestry
Revises: 0016_po_payment_ledger
"""

from alembic import op
import sqlalchemy as sa


revision = "0017_corrected_request_ancestry"
down_revision = "0016_po_payment_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("incoming_purchase_requests")}
    indexes = {index["name"] for index in inspector.get_indexes("incoming_purchase_requests")}
    if "source_request_id" not in columns:
        op.add_column(
            "incoming_purchase_requests",
            sa.Column("source_request_id", sa.String(), nullable=False, server_default=""),
        )
    if "ix_incoming_purchase_requests_source_request_id" not in indexes:
        op.create_index(
            "ix_incoming_purchase_requests_source_request_id",
            "incoming_purchase_requests", ["source_request_id"],
        )
    if "source_item_id" not in columns:
        op.add_column(
            "incoming_purchase_requests",
            sa.Column("source_item_id", sa.String(), nullable=False, server_default=""),
        )
    if "ix_incoming_purchase_requests_source_item_id" not in indexes:
        op.create_index(
            "ix_incoming_purchase_requests_source_item_id",
            "incoming_purchase_requests", ["source_item_id"],
        )


def downgrade() -> None:
    raise RuntimeError(
        "Destructive corrected-request ancestry downgrade is disabled; restore the verified backup."
    )
