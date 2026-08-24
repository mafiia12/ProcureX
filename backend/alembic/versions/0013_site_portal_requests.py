"""Add requester/delivery-destination and item-link columns for the Site Portal.

Revision ID: 0013_site_portal_requests
Revises: 0012_authentication
"""

from alembic import op
import sqlalchemy as sa


revision = "0013_site_portal_requests"
down_revision = "0012_authentication"
branch_labels = None
depends_on = None


def upgrade() -> None:
    request_columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("incoming_purchase_requests")}
    with op.batch_alter_table("incoming_purchase_requests") as batch:
        if "requester_user_id" not in request_columns:
            batch.add_column(sa.Column("requester_user_id", sa.String(), nullable=False, server_default=""))
        if "delivery_destination" not in request_columns:
            batch.add_column(sa.Column("delivery_destination", sa.String(), nullable=False, server_default=""))
    if "requester_user_id" not in request_columns:
        op.create_index(
            "ix_incoming_purchase_requests_requester_user_id",
            "incoming_purchase_requests", ["requester_user_id"],
        )

    item_columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("incoming_purchase_request_items")}
    with op.batch_alter_table("incoming_purchase_request_items") as batch:
        if "item_id" not in item_columns:
            batch.add_column(sa.Column("item_id", sa.String(), nullable=False, server_default=""))
    if "item_id" not in item_columns:
        op.create_index(
            "ix_incoming_purchase_request_items_item_id",
            "incoming_purchase_request_items", ["item_id"],
        )


def downgrade() -> None:
    raise RuntimeError(
        "Destructive site-portal-requests downgrade is disabled; restore the verified pre-migration backup."
    )
