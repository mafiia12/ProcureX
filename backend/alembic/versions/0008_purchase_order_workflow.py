"""Add purchase-order workflow tables and comparison request traceability.

Revision ID: 0008_purchase_order_workflow
Revises: 0007_purchase_request_item_review
"""

from alembic import op
import sqlalchemy as sa


revision = "0008_purchase_order_workflow"
down_revision = "0007_purchase_request_item_review"
branch_labels = None
depends_on = None


def _index_names(inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "price_comparisons" in tables:
        columns = {
            column["name"] for column in inspector.get_columns("price_comparisons")
        }
        with op.batch_alter_table("price_comparisons") as batch_op:
            if "source_request_id" not in columns:
                batch_op.add_column(sa.Column(
                    "source_request_id", sa.String(), nullable=False, server_default="",
                ))
            if "source_request_number" not in columns:
                batch_op.add_column(sa.Column(
                    "source_request_number", sa.String(), nullable=False, server_default="",
                ))

    if "purchase_orders" not in tables:
        op.create_table(
            "purchase_orders",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("po_number", sa.String(), nullable=False, unique=True),
            sa.Column("comparison_id", sa.String(), nullable=False, server_default=""),
            sa.Column("comparison_number", sa.String(), nullable=False, server_default=""),
            sa.Column("project_id", sa.String(), nullable=False, server_default=""),
            sa.Column("project_name", sa.String(), nullable=False, server_default=""),
            sa.Column("supplier_id", sa.String(), nullable=False, server_default=""),
            sa.Column("supplier_name", sa.String(), nullable=False, server_default=""),
            sa.Column("customer_id", sa.String(), nullable=False, server_default=""),
            sa.Column("customer_name", sa.String(), nullable=False, server_default=""),
            sa.Column("po_date", sa.String(), nullable=False, server_default=""),
            sa.Column("status", sa.String(), nullable=False, server_default="draft"),
            sa.Column("subtotal", sa.Float(), nullable=False, server_default="0"),
            sa.Column("discount_total", sa.Float(), nullable=False, server_default="0"),
            sa.Column("vat_total", sa.Float(), nullable=False, server_default="0"),
            sa.Column("shipping_total", sa.Float(), nullable=False, server_default="0"),
            sa.Column("other_total", sa.Float(), nullable=False, server_default="0"),
            sa.Column("final_total", sa.Float(), nullable=False, server_default="0"),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_by", sa.String(), nullable=False, server_default=""),
            sa.Column("created_at", sa.String(), nullable=False, server_default=""),
            sa.Column("updated_at", sa.String(), nullable=False, server_default=""),
            sa.Column("extra_data", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        )

    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "purchase_order_items" not in tables:
        op.create_table(
            "purchase_order_items",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("purchase_order_id", sa.String(), nullable=False),
            sa.Column("item_id", sa.String(), nullable=False, server_default=""),
            sa.Column("item_code", sa.String(), nullable=False, server_default=""),
            sa.Column("product_name", sa.String(), nullable=False, server_default=""),
            sa.Column("brand", sa.String(), nullable=False, server_default=""),
            sa.Column("specifications", sa.Text(), nullable=False, server_default=""),
            sa.Column("quantity", sa.Float(), nullable=False, server_default="0"),
            sa.Column("unit", sa.String(), nullable=False, server_default=""),
            sa.Column("unit_price", sa.Float(), nullable=False, server_default="0"),
            sa.Column("discount_pct", sa.Float(), nullable=False, server_default="0"),
            sa.Column("vat_pct", sa.Float(), nullable=False, server_default="0"),
            sa.Column("shipping_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("other_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("line_total", sa.Float(), nullable=False, server_default="0"),
            sa.Column("extra_data", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        )

    inspector = sa.inspect(bind)
    index_specs = {
        "purchase_orders": {
            "ix_purchase_orders_po_number": (["po_number"], True),
            "ix_purchase_orders_comparison_id": (["comparison_id"], False),
            "ix_purchase_orders_project_id": (["project_id"], False),
            "ix_purchase_orders_supplier_id": (["supplier_id"], False),
            "ix_purchase_orders_po_date": (["po_date"], False),
            "ix_purchase_orders_status": (["status"], False),
        },
        "purchase_order_items": {
            "ix_purchase_order_items_purchase_order_id": (["purchase_order_id"], False),
            "ix_purchase_order_items_item_id": (["item_id"], False),
            "ix_purchase_order_items_item_code": (["item_code"], False),
        },
    }
    for table_name, specs in index_specs.items():
        existing = _index_names(inspector, table_name)
        for name, (columns, unique) in specs.items():
            if name not in existing:
                op.create_index(name, table_name, columns, unique=unique)


def downgrade() -> None:
    raise RuntimeError(
        "Destructive purchase-order workflow downgrade is disabled; restore a verified backup."
    )
