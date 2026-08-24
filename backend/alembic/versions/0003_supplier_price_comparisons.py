"""Add the isolated supplier price-comparison module.

Revision ID: 0003_supplier_price_comparisons
Revises: 0002_business_code_sequences
"""

import sqlalchemy as sa
from alembic import op


revision = "0003_supplier_price_comparisons"
down_revision = "0002_business_code_sequences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "price_comparisons" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "price_comparisons",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("comparison_number", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=True),
        sa.Column("project_name", sa.String(), nullable=False, server_default=""),
        sa.Column("customer_id", sa.String(), nullable=True),
        sa.Column("customer_name", sa.String(), nullable=False, server_default=""),
        sa.Column("comparison_date", sa.String(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("comparison_number"),
    )
    op.create_index("ix_price_comparisons_number", "price_comparisons", ["comparison_number"], unique=True)
    op.create_index("ix_price_comparisons_date", "price_comparisons", ["comparison_date"])
    op.create_index("ix_price_comparisons_project", "price_comparisons", ["project_id"])
    op.create_index("ix_price_comparisons_customer", "price_comparisons", ["customer_id"])
    op.create_index("ix_price_comparisons_updated", "price_comparisons", ["updated_at"])

    op.create_table(
        "price_comparison_rows",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("comparison_id", sa.String(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.String(), nullable=True),
        sa.Column("item_code", sa.String(), nullable=False),
        sa.Column("product_name", sa.String(), nullable=False),
        sa.Column("brand", sa.String(), nullable=False, server_default=""),
        sa.Column("unit", sa.String(), nullable=False, server_default=""),
        sa.Column("supplier_id", sa.String(), nullable=True),
        sa.Column("supplier_code", sa.String(), nullable=False),
        sa.Column("supplier_name", sa.String(), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("unit_price", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("discount_pct", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("tax_pct", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("shipping_cost", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("other_cost", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("delivery_days", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("payment_terms", sa.String(), nullable=False, server_default=""),
        sa.Column("availability", sa.String(), nullable=False, server_default="available"),
        sa.Column("price_valid_until", sa.String(), nullable=False, server_default=""),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(
            ["comparison_id"], ["price_comparisons.id"], ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["item_id"], ["items.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "comparison_id", "item_id", "supplier_id",
            name="uq_price_comparison_item_supplier",
        ),
    )
    op.create_index(
        "ix_price_comparison_rows_comparison", "price_comparison_rows", ["comparison_id"],
    )
    op.create_index("ix_price_comparison_rows_item", "price_comparison_rows", ["item_id"])
    op.create_index(
        "ix_price_comparison_rows_supplier", "price_comparison_rows", ["supplier_id"],
    )
    op.create_index(
        "ix_price_comparison_rows_availability", "price_comparison_rows", ["availability"],
    )
    op.create_index(
        "ix_price_comparison_rows_item_supplier", "price_comparison_rows",
        ["item_id", "supplier_id"],
    )
    op.create_index(
        "ix_price_comparison_rows_comparison_position", "price_comparison_rows",
        ["comparison_id", "position"],
    )


def downgrade() -> None:
    raise RuntimeError(
        "Destructive production downgrade is disabled. Restore a verified backup instead."
    )
