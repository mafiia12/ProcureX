"""Add WhatsApp intake support: a phone number on users, plus the small
draft/idempotency state needed to turn a confirmed WhatsApp conversation into
an existing Incoming Purchase Request.

Revision ID: 0020_whatsapp_intake
Revises: 0019_daily_reports
"""

from alembic import op
import sqlalchemy as sa


revision = "0020_whatsapp_intake"
down_revision = "0019_daily_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    user_columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}
    with op.batch_alter_table("users") as batch:
        if "phone_e164" not in user_columns:
            batch.add_column(sa.Column("phone_e164", sa.String(), nullable=False, server_default=""))

    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if "whatsapp_processed_messages" not in tables:
        op.create_table(
            "whatsapp_processed_messages",
            sa.Column("message_id", sa.String(), primary_key=True),
            sa.Column("processed_at", sa.String(), nullable=False),
        )

    if "whatsapp_drafts" not in tables:
        op.create_table(
            "whatsapp_drafts",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("phone_e164", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False, server_default="collecting"),
            sa.Column("user_id", sa.String(), nullable=False, server_default=""),
            sa.Column("project_id", sa.String(), nullable=False, server_default=""),
            sa.Column("project_name", sa.String(), nullable=False, server_default=""),
            sa.Column("candidate_projects_json", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("items_json", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("pending_item_index", sa.Integer(), nullable=False, server_default="-1"),
            sa.Column("required_delivery_date", sa.String(), nullable=False, server_default=""),
            sa.Column("confirmed_request_id", sa.String(), nullable=False, server_default=""),
            sa.Column("confirmed_request_number", sa.String(), nullable=False, server_default=""),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.Column("updated_at", sa.String(), nullable=False),
            sa.Column("expires_at", sa.String(), nullable=False),
        )
        op.create_index("ix_whatsapp_drafts_phone_e164", "whatsapp_drafts", ["phone_e164"])


def downgrade() -> None:
    raise RuntimeError(
        "Destructive whatsapp-intake downgrade is disabled; restore the verified pre-migration backup."
    )
