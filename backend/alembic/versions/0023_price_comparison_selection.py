"""Add the selected-for-purchase flag required by comparison workflows.

Revision ID: 0023_price_comparison_selection
Revises: 0022_returned_item_corrections
"""

from alembic import op
import sqlalchemy as sa


revision = "0023_price_comparison_selection"
down_revision = "0022_returned_item_corrections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("price_comparison_rows")
    }
    if "selected_for_purchase" not in columns:
        op.add_column(
            "price_comparison_rows",
            sa.Column(
                "selected_for_purchase",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )


def downgrade() -> None:
    raise RuntimeError(
        "Destructive price-comparison-selection downgrade is disabled; "
        "restore the verified pre-migration backup."
    )
