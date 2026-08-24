"""Create the ProcureX PostgreSQL production baseline.

Revision ID: 0001_production_baseline
Revises: None
"""

from alembic import op

from database import Base
import incoming_requests  # noqa: F401 - registers incoming-request tables


revision = "0001_production_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # This baseline is intentionally generated from the same SQLAlchemy metadata
    # used by the application, avoiding drift across the legacy ERP tables.
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    raise RuntimeError(
        "Destructive production downgrade is disabled. Restore a verified backup instead."
    )
