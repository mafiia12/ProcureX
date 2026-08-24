"""Add the minimum business-stage metadata to approval snapshots.

Revision ID: 0010_approval_business_stages
Revises: 0009_guided_procurement_workflow
"""

from alembic import op
import sqlalchemy as sa


revision = "0010_approval_business_stages"
down_revision = "0009_guided_procurement_workflow"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "engineer_approvals" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("engineer_approvals")}
    definitions = {
        "approval_type": sa.Column(
            "approval_type", sa.String(), nullable=False, server_default="external_engineer"
        ),
        "approval_stage": sa.Column(
            "approval_stage", sa.String(), nullable=False, server_default="external_review"
        ),
        "responsible_role": sa.Column(
            "responsible_role", sa.String(), nullable=False, server_default="external_engineer"
        ),
    }
    with op.batch_alter_table("engineer_approvals") as batch:
        for name, column in definitions.items():
            if name not in existing:
                batch.add_column(column)


def downgrade() -> None:
    raise RuntimeError(
        "Destructive approval-stage downgrade is disabled; restore the verified pre-migration backup."
    )
