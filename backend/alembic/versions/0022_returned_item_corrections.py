"""Add item-level ancestry/draft columns behind grouped Site Portal
correction resubmission: incoming_purchase_request_items.source_item_id
(the item-level counterpart of incoming_purchase_requests.source_item_id —
needed because one grouped corrected REQ can carry several corrected lines,
each tracing back to a different original item) and .correction_draft (the
pending correction an engineer has saved but not yet resubmitted).

Revision ID: 0022_returned_item_corrections
Revises: 0021_whatsapp_settings_and_source
"""

from alembic import op
import sqlalchemy as sa


revision = "0022_returned_item_corrections"
down_revision = "0021_whatsapp_settings_and_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("incoming_purchase_request_items")}
    with op.batch_alter_table("incoming_purchase_request_items") as batch:
        if "source_item_id" not in columns:
            batch.add_column(sa.Column("source_item_id", sa.String(), nullable=False, server_default=""))
        if "correction_draft" not in columns:
            batch.add_column(sa.Column("correction_draft", sa.JSON(), nullable=False, server_default="{}"))
    if "source_item_id" not in columns:
        op.create_index(
            "ix_incoming_purchase_request_items_source_item_id",
            "incoming_purchase_request_items", ["source_item_id"],
        )


def downgrade() -> None:
    raise RuntimeError(
        "Destructive returned-item-corrections downgrade is disabled; restore the verified backup."
    )
