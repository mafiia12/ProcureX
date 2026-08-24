"""Add the purchase_order_payments table for the real PO payment ledger.

Revision ID: 0016_po_payment_ledger
Revises: 0015_rfq_supplier_quotations
"""

from alembic import op
import sqlalchemy as sa


revision = "0016_po_payment_ledger"
down_revision = "0015_rfq_supplier_quotations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if "purchase_order_payments" not in tables:
        op.create_table(
            "purchase_order_payments",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("payment_number", sa.String(), nullable=False),
            sa.Column(
                "purchase_order_id", sa.String(),
                sa.ForeignKey("purchase_orders.id", ondelete="RESTRICT"), nullable=False,
            ),
            sa.Column("idempotency_key", sa.String(), nullable=False),
            sa.Column("payment_date", sa.String(), nullable=False),
            sa.Column("amount", sa.Float(), nullable=False),
            sa.Column("payment_method", sa.String(), nullable=False, server_default=""),
            sa.Column("payment_reference", sa.String(), nullable=False, server_default=""),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(), nullable=False, server_default="recorded"),
            sa.Column("void_reason", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_by", sa.String(), nullable=False, server_default=""),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.Column("updated_at", sa.String(), nullable=False),
            sa.UniqueConstraint("payment_number", name="uq_purchase_order_payments_number"),
            sa.UniqueConstraint(
                "purchase_order_id", "idempotency_key", name="uq_po_payment_idempotency",
            ),
        )
        op.create_index("ix_po_payments_order", "purchase_order_payments", ["purchase_order_id"])
        op.create_index("ix_po_payments_status", "purchase_order_payments", ["status"])


def downgrade() -> None:
    raise RuntimeError(
        "Destructive po-payment-ledger downgrade is disabled; restore the verified pre-migration backup."
    )
