"""Persist manual-entry classification snapshots on comparison rows.

Revision ID: 0004_price_comparison_manual_entry
Revises: 0003_supplier_price_comparisons
"""

import sqlalchemy as sa
from alembic import op


revision = "0004_price_comparison_manual_entry"
down_revision = "0003_supplier_price_comparisons"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {
        column["name"]
        for column in inspector.get_columns("price_comparison_rows")
    }
    for name, column_type in (
        ("main_category", sa.String()),
        ("subcategory", sa.String()),
        ("specifications", sa.Text()),
    ):
        if name not in columns:
            op.add_column(
                "price_comparison_rows",
                sa.Column(name, column_type, nullable=False, server_default=""),
            )

    inspector = sa.inspect(op.get_bind())
    indexes = {
        index["name"]
        for index in inspector.get_indexes("price_comparison_rows")
    }
    if "ix_price_comparison_rows_product_name" not in indexes:
        op.create_index(
            "ix_price_comparison_rows_product_name",
            "price_comparison_rows",
            ["product_name"],
        )
    if "ix_price_comparison_rows_supplier_name" not in indexes:
        op.create_index(
            "ix_price_comparison_rows_supplier_name",
            "price_comparison_rows",
            ["supplier_name"],
        )


def downgrade() -> None:
    raise RuntimeError(
        "Destructive production downgrade is disabled. Restore a verified backup instead."
    )
