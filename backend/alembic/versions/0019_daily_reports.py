"""Add the daily_reports table for the Daily Procurement Report feature.

Revision ID: 0019_daily_reports
Revises: 0018_supplier_offer_adjustments
"""

from alembic import op
import sqlalchemy as sa


revision = "0019_daily_reports"
down_revision = "0018_supplier_offer_adjustments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if "daily_reports" not in tables:
        op.create_table(
            "daily_reports",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("report_date", sa.String(), nullable=False),
            sa.Column("report_number", sa.String(), nullable=False),
            sa.Column("general_notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("key_risks", sa.Text(), nullable=False, server_default=""),
            sa.Column("follow_up_notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("closed_at", sa.String(), nullable=False, server_default=""),
            sa.Column("closed_by", sa.String(), nullable=False, server_default=""),
            sa.Column("snapshot_data", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("created_by", sa.String(), nullable=False, server_default=""),
            sa.Column("updated_by", sa.String(), nullable=False, server_default=""),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.Column("updated_at", sa.String(), nullable=False),
            sa.UniqueConstraint("report_date", name="uq_daily_reports_date"),
            sa.UniqueConstraint("report_number", name="uq_daily_reports_number"),
        )
        op.create_index("ix_daily_reports_date", "daily_reports", ["report_date"])


def downgrade() -> None:
    raise RuntimeError(
        "Destructive daily-reports downgrade is disabled; restore the verified pre-migration backup."
    )
