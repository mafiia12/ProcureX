"""Add incoming_request_general_attachments for request-level Site Portal uploads.

Revision ID: 0014_site_portal_attachments
Revises: 0013_site_portal_requests
"""

from alembic import op
import sqlalchemy as sa


revision = "0014_site_portal_attachments"
down_revision = "0013_site_portal_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "incoming_request_general_attachments" not in tables:
        op.create_table(
            "incoming_request_general_attachments",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("request_id", sa.String(), sa.ForeignKey("incoming_purchase_requests.id", ondelete="CASCADE"), nullable=False),
            sa.Column("original_filename", sa.String(), nullable=False),
            sa.Column("stored_filename", sa.String(), nullable=False),
            sa.Column("media_type", sa.String(), nullable=False),
            sa.Column("size_bytes", sa.Integer(), nullable=False),
            sa.Column("sha256", sa.String(), nullable=False),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.UniqueConstraint("stored_filename", name="uq_incoming_request_general_attachments_stored_filename"),
        )
        op.create_index(
            "ix_incoming_request_general_attachments_request_id",
            "incoming_request_general_attachments", ["request_id"],
        )


def downgrade() -> None:
    raise RuntimeError(
        "Destructive site-portal-attachments downgrade is disabled; restore the verified pre-migration backup."
    )
