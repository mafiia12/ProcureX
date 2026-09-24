"""Add shared rate-limit counters so limits hold across workers/instances.

The login and public-request limiters kept their counts in process memory,
so every uvicorn worker enforced its own window (2 workers = up to 2x the
configured limit). This table is their shared, durable store.

Revision ID: 0024_rate_limit_events
Revises: 0023_price_comparison_selection
"""

from alembic import op
import sqlalchemy as sa


revision = "0024_rate_limit_events"
down_revision = "0023_price_comparison_selection"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "rate_limit_events" not in tables:
        op.create_table(
            "rate_limit_events",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("scope", sa.String(), nullable=False),
            sa.Column("key_hash", sa.String(), nullable=False),
            sa.Column("created_at", sa.Float(), nullable=False),
        )
    indexes = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes("rate_limit_events")}
    if "ix_rate_limit_events_scope_key_time" not in indexes:
        op.create_index(
            "ix_rate_limit_events_scope_key_time",
            "rate_limit_events",
            ["scope", "key_hash", "created_at"],
        )


def downgrade() -> None:
    raise RuntimeError(
        "Destructive rate-limit-events downgrade is disabled; "
        "restore the verified pre-migration backup."
    )
