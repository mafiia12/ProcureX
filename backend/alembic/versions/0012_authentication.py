"""Add users and user_project_access for ProcureX authentication.

Revision ID: 0012_authentication
Revises: 0011_site_receiving
"""

from alembic import op
import sqlalchemy as sa


revision = "0012_authentication"
down_revision = "0011_site_receiving"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "users" not in tables:
        op.create_table(
            "users",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("username", sa.String(), nullable=False),
            sa.Column("display_name", sa.String(), nullable=False, server_default=""),
            sa.Column("password_hash", sa.String(), nullable=False),
            sa.Column("account_type", sa.String(), nullable=False),
            sa.Column("role", sa.String(), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.Column("updated_at", sa.String(), nullable=False),
            sa.UniqueConstraint("username", name="uq_users_username"),
            sa.CheckConstraint(
                "account_type IN ('erp', 'site_portal')",
                name="ck_users_account_type",
            ),
            sa.CheckConstraint(
                "(account_type = 'erp' AND role IN "
                "('admin', 'procurement_responsible', 'procurement_engineer', 'commercial_manager')) "
                "OR (account_type = 'site_portal' AND role = 'site_engineer')",
                name="ck_users_role_matches_account_type",
            ),
        )
        op.create_index("ix_users_username", "users", ["username"])
        op.create_index("ix_users_account_type", "users", ["account_type"])
        op.create_index("ix_users_role", "users", ["role"])
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "user_project_access" not in tables:
        op.create_table(
            "user_project_access",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("project_id", sa.String(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.UniqueConstraint("user_id", "project_id", name="uq_user_project_access"),
        )
        op.create_index("ix_user_project_access_user_id", "user_project_access", ["user_id"])
        op.create_index("ix_user_project_access_project_id", "user_project_access", ["project_id"])


def downgrade() -> None:
    raise RuntimeError(
        "Destructive authentication downgrade is disabled; restore the verified pre-migration backup."
    )
