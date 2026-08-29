"""Add incoming_purchase_requests.source (intake channel, for the Incoming
Requests list badge) and the whatsapp_settings singleton table (Admin
on/off toggle plus last-known Meta connection/webhook state).

Revision ID: 0021_whatsapp_settings_and_source
Revises: 0020_whatsapp_intake
"""

from alembic import op
import sqlalchemy as sa


revision = "0021_whatsapp_settings_and_source"
down_revision = "0020_whatsapp_intake"
branch_labels = None
depends_on = None


def upgrade() -> None:
    request_columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("incoming_purchase_requests")}
    with op.batch_alter_table("incoming_purchase_requests") as batch:
        if "source" not in request_columns:
            batch.add_column(sa.Column("source", sa.String(), nullable=False, server_default=""))
    if "source" not in request_columns:
        op.create_index(
            "ix_incoming_purchase_requests_source",
            "incoming_purchase_requests", ["source"],
        )

    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "whatsapp_settings" not in tables:
        op.create_table(
            "whatsapp_settings",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("business_number", sa.String(), nullable=False, server_default=""),
            sa.Column("business_name", sa.String(), nullable=False, server_default=""),
            sa.Column("connection_status", sa.String(), nullable=False, server_default="unknown"),
            sa.Column("connection_error", sa.String(), nullable=False, server_default=""),
            sa.Column("last_checked_at", sa.String(), nullable=False, server_default=""),
            sa.Column("last_webhook_verified_at", sa.String(), nullable=False, server_default=""),
            sa.Column("last_webhook_event_at", sa.String(), nullable=False, server_default=""),
            sa.Column("updated_by", sa.String(), nullable=False, server_default=""),
            sa.Column("updated_at", sa.String(), nullable=False, server_default=""),
        )


def downgrade() -> None:
    raise RuntimeError(
        "Destructive whatsapp-settings-and-source downgrade is disabled; restore the verified pre-migration backup."
    )
