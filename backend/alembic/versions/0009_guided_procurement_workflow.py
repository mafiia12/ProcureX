"""Add project linking, approval snapshots, approval payments, and audit events.

Revision ID: 0009_guided_procurement_workflow
Revises: 0008_purchase_order_workflow
"""

from alembic import op
import sqlalchemy as sa


revision = "0009_guided_procurement_workflow"
down_revision = "0008_purchase_order_workflow"
branch_labels = None
depends_on = None


def _columns(inspector, table: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "incoming_purchase_requests" in tables:
        existing = _columns(inspector, "incoming_purchase_requests")
        with op.batch_alter_table("incoming_purchase_requests") as batch:
            for name in ("project_id", "customer_id", "customer_name"):
                if name not in existing:
                    batch.add_column(sa.Column(name, sa.String(), nullable=False, server_default=""))

    if "purchase_orders" in tables:
        existing = _columns(inspector, "purchase_orders")
        with op.batch_alter_table("purchase_orders") as batch:
            for name in ("source_request_id", "source_request_number", "approval_id", "approval_number"):
                if name not in existing:
                    batch.add_column(sa.Column(name, sa.String(), nullable=False, server_default=""))

    if "engineer_approvals" not in tables:
        op.create_table(
            "engineer_approvals",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("approval_number", sa.String(), nullable=False, unique=True),
            sa.Column("secure_token", sa.String(), nullable=False, unique=True),
            sa.Column("project_id", sa.String(), nullable=False, server_default=""),
            sa.Column("project_name", sa.String(), nullable=False, server_default=""),
            sa.Column("customer_id", sa.String(), nullable=False, server_default=""),
            sa.Column("customer_name", sa.String(), nullable=False, server_default=""),
            sa.Column("source_request_id", sa.String(), nullable=False, server_default=""),
            sa.Column("source_request_number", sa.String(), nullable=False, server_default=""),
            sa.Column("comparison_id", sa.String(), nullable=False),
            sa.Column("comparison_number", sa.String(), nullable=False, server_default=""),
            sa.Column("previous_revision_id", sa.String(), nullable=False, server_default=""),
            sa.Column("revision_number", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(), nullable=False, server_default="draft"),
            sa.Column("subtotal", sa.Float(), nullable=False, server_default="0"),
            sa.Column("discount_total", sa.Float(), nullable=False, server_default="0"),
            sa.Column("tax_total", sa.Float(), nullable=False, server_default="0"),
            sa.Column("shipping_total", sa.Float(), nullable=False, server_default="0"),
            sa.Column("other_total", sa.Float(), nullable=False, server_default="0"),
            sa.Column("final_total", sa.Float(), nullable=False, server_default="0"),
            sa.Column("engineer_name", sa.String(), nullable=False, server_default=""),
            sa.Column("engineer_email", sa.String(), nullable=False, server_default=""),
            sa.Column("engineer_phone", sa.String(), nullable=False, server_default=""),
            sa.Column("sent_at", sa.String(), nullable=False, server_default=""),
            sa.Column("first_opened_at", sa.String(), nullable=False, server_default=""),
            sa.Column("last_opened_at", sa.String(), nullable=False, server_default=""),
            sa.Column("approved_at", sa.String(), nullable=False, server_default=""),
            sa.Column("rejected_at", sa.String(), nullable=False, server_default=""),
            sa.Column("revision_requested_at", sa.String(), nullable=False, server_default=""),
            sa.Column("expiry_at", sa.String(), nullable=False, server_default=""),
            sa.Column("decision_note", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_by", sa.String(), nullable=False, server_default=""),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.Column("updated_at", sa.String(), nullable=False),
            sa.UniqueConstraint("comparison_id", "revision_number", name="uq_approval_comparison_revision"),
        )

    if "engineer_approval_lines" not in tables:
        op.create_table(
            "engineer_approval_lines",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("approval_id", sa.String(), sa.ForeignKey("engineer_approvals.id", ondelete="CASCADE"), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("item_id", sa.String(), nullable=False, server_default=""),
            sa.Column("item_code", sa.String(), nullable=False, server_default=""),
            sa.Column("product_name", sa.String(), nullable=False),
            sa.Column("brand", sa.String(), nullable=False, server_default=""),
            sa.Column("specifications", sa.Text(), nullable=False, server_default=""),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("unit", sa.String(), nullable=False, server_default=""),
            sa.Column("supplier_id", sa.String(), nullable=False, server_default=""),
            sa.Column("supplier_name", sa.String(), nullable=False),
            sa.Column("unit_price", sa.Float(), nullable=False),
            sa.Column("discount_pct", sa.Float(), nullable=False, server_default="0"),
            sa.Column("tax_pct", sa.Float(), nullable=False, server_default="0"),
            sa.Column("shipping_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("other_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("line_total", sa.Float(), nullable=False),
            sa.Column("delivery_days", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("payment_terms", sa.String(), nullable=False, server_default=""),
            sa.Column("price_valid_until", sa.String(), nullable=False, server_default=""),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
            sa.UniqueConstraint("approval_id", "position", name="uq_approval_line_position"),
        )

    if "approval_payments" not in tables:
        op.create_table(
            "approval_payments",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("approval_id", sa.String(), sa.ForeignKey("engineer_approvals.id", ondelete="CASCADE"), nullable=False),
            sa.Column("method", sa.String(), nullable=False),
            sa.Column("amount", sa.Float(), nullable=False),
            sa.Column("currency", sa.String(), nullable=False, server_default="EGP"),
            sa.Column("status", sa.String(), nullable=False, server_default="pending"),
            sa.Column("payment_reference", sa.String(), nullable=False, server_default=""),
            sa.Column("external_reference", sa.String(), nullable=False, server_default=""),
            sa.Column("cash_reference", sa.String(), nullable=False, server_default=""),
            sa.Column("cash_consumed_at", sa.String(), nullable=False, server_default=""),
            sa.Column("proof_storage_key", sa.String(), nullable=False, server_default=""),
            sa.Column("proof_original_name", sa.String(), nullable=False, server_default=""),
            sa.Column("proof_media_type", sa.String(), nullable=False, server_default=""),
            sa.Column("proof_size", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("proof_sha256", sa.String(), nullable=False, server_default=""),
            sa.Column("proof_uploaded_at", sa.String(), nullable=False, server_default=""),
            sa.Column("payer_note", sa.Text(), nullable=False, server_default=""),
            sa.Column("reviewed_by", sa.String(), nullable=False, server_default=""),
            sa.Column("reviewed_at", sa.String(), nullable=False, server_default=""),
            sa.Column("paid_at", sa.String(), nullable=False, server_default=""),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.Column("updated_at", sa.String(), nullable=False),
        )

    if "workflow_audit_events" not in tables:
        op.create_table(
            "workflow_audit_events",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("entity_type", sa.String(), nullable=False),
            sa.Column("entity_id", sa.String(), nullable=False),
            sa.Column("project_id", sa.String(), nullable=False, server_default=""),
            sa.Column("event_type", sa.String(), nullable=False),
            sa.Column("actor_type", sa.String(), nullable=False, server_default="internal"),
            sa.Column("actor_name", sa.String(), nullable=False, server_default=""),
            sa.Column("message", sa.Text(), nullable=False, server_default=""),
            sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("created_at", sa.String(), nullable=False),
        )

    inspector = sa.inspect(bind)
    specs = {
        "incoming_purchase_requests": [("ix_incoming_purchase_requests_project_id", ["project_id"]), ("ix_incoming_purchase_requests_customer_id", ["customer_id"])],
        "purchase_orders": [("ix_purchase_orders_source_request_id", ["source_request_id"]), ("ix_purchase_orders_approval_id", ["approval_id"])],
        "engineer_approvals": [("ix_engineer_approvals_project", ["project_id"]), ("ix_engineer_approvals_status", ["status"])],
        "engineer_approval_lines": [("ix_engineer_approval_lines_approval", ["approval_id"])],
        "approval_payments": [("ix_approval_payments_approval", ["approval_id"]), ("ix_approval_payments_status", ["status"]), ("ix_approval_payments_cash_reference", ["cash_reference"])],
        "workflow_audit_events": [("ix_workflow_audit_entity", ["entity_type", "entity_id"]), ("ix_workflow_audit_project", ["project_id"]), ("ix_workflow_audit_created", ["created_at"])],
    }
    for table, indexes in specs.items():
        if table not in inspector.get_table_names():
            continue
        existing = {item["name"] for item in inspector.get_indexes(table)}
        for name, columns in indexes:
            if name not in existing:
                op.create_index(name, table, columns, unique=name.endswith("cash_reference"))


def downgrade() -> None:
    raise RuntimeError(
        "Destructive guided-workflow downgrade is disabled; restore the verified pre-migration backup."
    )
