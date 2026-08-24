"""Add append-only purchase-order receiving events.

Revision ID: 0011_site_receiving
Revises: 0010_approval_business_stages
"""

from alembic import op
import sqlalchemy as sa


revision = "0011_site_receiving"
down_revision = "0010_approval_business_stages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "purchase_order_receipts" not in tables:
        op.create_table(
            "purchase_order_receipts",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("purchase_order_id", sa.String(), sa.ForeignKey("purchase_orders.id", ondelete="CASCADE"), nullable=False),
            sa.Column("idempotency_key", sa.String(), nullable=False),
            sa.Column("receipt_type", sa.String(), nullable=False),
            sa.Column("actor_role", sa.String(), nullable=False, server_default="procurement_officer"),
            sa.Column("actor_name", sa.String(), nullable=False, server_default=""),
            sa.Column("note", sa.Text(), nullable=False, server_default=""),
            sa.Column("problem_reason", sa.String(), nullable=False, server_default=""),
            sa.Column("affected_item_id", sa.String(), nullable=False, server_default=""),
            sa.Column("affected_quantity", sa.Float(), nullable=False, server_default="0"),
            sa.Column("po_number", sa.String(), nullable=False, server_default=""),
            sa.Column("project_name", sa.String(), nullable=False, server_default=""),
            sa.Column("supplier_name", sa.String(), nullable=False, server_default=""),
            sa.Column("received_at", sa.String(), nullable=False),
            sa.UniqueConstraint("purchase_order_id", "idempotency_key", name="uq_po_receipt_idempotency"),
        )
        op.create_index("ix_po_receipts_order", "purchase_order_receipts", ["purchase_order_id"])
        op.create_index("ix_po_receipts_received_at", "purchase_order_receipts", ["received_at"])
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "purchase_order_receipt_lines" not in tables:
        op.create_table(
            "purchase_order_receipt_lines",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("receipt_id", sa.String(), sa.ForeignKey("purchase_order_receipts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("purchase_order_item_id", sa.String(), sa.ForeignKey("purchase_order_items.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("item_code", sa.String(), nullable=False, server_default=""),
            sa.Column("product_name", sa.String(), nullable=False, server_default=""),
            sa.Column("unit", sa.String(), nullable=False, server_default=""),
            sa.Column("ordered_quantity", sa.Float(), nullable=False),
            sa.Column("previously_received_quantity", sa.Float(), nullable=False, server_default="0"),
            sa.Column("received_quantity", sa.Float(), nullable=False, server_default="0"),
            sa.Column("remaining_quantity", sa.Float(), nullable=False, server_default="0"),
            sa.UniqueConstraint("receipt_id", "purchase_order_item_id", name="uq_po_receipt_line_item"),
        )
        op.create_index("ix_po_receipt_lines_receipt", "purchase_order_receipt_lines", ["receipt_id"])


def downgrade() -> None:
    raise RuntimeError(
        "Destructive receiving downgrade is disabled; restore the verified pre-migration backup."
    )
