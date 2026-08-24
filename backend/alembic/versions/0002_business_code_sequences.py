"""Add persistent, no-reuse business-code counters.

Revision ID: 0002_business_code_sequences
Revises: 0001_production_baseline
"""

import sqlalchemy as sa
from alembic import op

from schema_contract import reconcile_business_code_check


revision = "0002_business_code_sequences"
down_revision = "0001_production_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "business_code_sequences" not in sa.inspect(bind).get_table_names():
        op.create_table(
            "business_code_sequences",
            sa.Column("entity", sa.String(), nullable=False),
            sa.Column("next_value", sa.Integer(), nullable=False),
            sa.CheckConstraint(
                "next_value > 0", name="ck_business_code_sequences_positive"
            ),
            sa.PrimaryKeyConstraint("entity"),
        )
        return
    if bind.dialect.name == "sqlite":
        reconcile_business_code_check(bind)
        return
    checks = {
        item.get("name")
        for item in sa.inspect(bind).get_check_constraints("business_code_sequences")
    }
    if "ck_business_code_sequences_positive" not in checks:
        op.create_check_constraint(
            "ck_business_code_sequences_positive",
            "business_code_sequences",
            "next_value > 0",
        )


def downgrade() -> None:
    raise RuntimeError(
        "Destructive production downgrade is disabled. Restore a verified backup instead."
    )
