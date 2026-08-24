"""Add item-level review fields to incoming purchase requests.

Revision ID: 0007_purchase_request_item_review
Revises: 0006_construction_calculator
"""

from alembic import op
import sqlalchemy as sa


revision = "0007_purchase_request_item_review"
down_revision = "0006_construction_calculator"
branch_labels = None
depends_on = None


TABLE_NAME = "incoming_purchase_request_items"
INDEX_NAME = "ix_incoming_purchase_request_items_review_status"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    existing_columns = {
        column["name"]
        for column in inspector.get_columns(TABLE_NAME)
    }

    with op.batch_alter_table(TABLE_NAME) as batch_op:
        if "review_status" not in existing_columns:
            batch_op.add_column(
                sa.Column(
                    "review_status",
                    sa.String(),
                    nullable=False,
                    server_default="pending",
                )
            )

        if "review_reason" not in existing_columns:
            batch_op.add_column(
                sa.Column(
                    "review_reason",
                    sa.Text(),
                    nullable=False,
                    server_default="",
                )
            )

        if "reviewed_by" not in existing_columns:
            batch_op.add_column(
                sa.Column(
                    "reviewed_by",
                    sa.String(),
                    nullable=False,
                    server_default="",
                )
            )

        if "reviewed_at" not in existing_columns:
            batch_op.add_column(
                sa.Column(
                    "reviewed_at",
                    sa.String(),
                    nullable=False,
                    server_default="",
                )
            )

    inspector = sa.inspect(bind)
    existing_indexes = {
        index["name"]
        for index in inspector.get_indexes(TABLE_NAME)
    }

    if INDEX_NAME not in existing_indexes:
        op.create_index(
            INDEX_NAME,
            TABLE_NAME,
            ["review_status"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    existing_columns = {
        column["name"]
        for column in inspector.get_columns(TABLE_NAME)
    }

    existing_indexes = {
        index["name"]
        for index in inspector.get_indexes(TABLE_NAME)
    }

    if INDEX_NAME in existing_indexes:
        op.drop_index(INDEX_NAME, table_name=TABLE_NAME)

    with op.batch_alter_table(TABLE_NAME) as batch_op:
        if "reviewed_at" in existing_columns:
            batch_op.drop_column("reviewed_at")

        if "reviewed_by" in existing_columns:
            batch_op.drop_column("reviewed_by")

        if "review_reason" in existing_columns:
            batch_op.drop_column("review_reason")

        if "review_status" in existing_columns:
            batch_op.drop_column("review_status")