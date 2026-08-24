"""Add the isolated RFQ / supplier-quotation workflow tables.

Revision ID: 0015_rfq_supplier_quotations
Revises: 0014_site_portal_attachments
"""

from alembic import op
import sqlalchemy as sa


revision = "0015_rfq_supplier_quotations"
down_revision = "0014_site_portal_attachments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if "rfqs" not in tables:
        op.create_table(
            "rfqs",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("rfq_number", sa.String(), nullable=False),
            sa.Column(
                "source_request_id", sa.String(),
                sa.ForeignKey("incoming_purchase_requests.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("source_request_number", sa.String(), nullable=False, server_default=""),
            sa.Column(
                "project_id", sa.String(),
                sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True,
            ),
            sa.Column("project_name", sa.String(), nullable=False, server_default=""),
            sa.Column("rfq_date", sa.String(), nullable=False),
            sa.Column("deadline", sa.String(), nullable=False, server_default=""),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_by", sa.String(), nullable=False, server_default=""),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.Column("updated_at", sa.String(), nullable=False),
            sa.UniqueConstraint("rfq_number", name="uq_rfqs_rfq_number"),
            sa.UniqueConstraint("source_request_id", name="uq_rfqs_source_request_id"),
        )
        op.create_index("ix_rfqs_project", "rfqs", ["project_id"])
        op.create_index("ix_rfqs_updated", "rfqs", ["updated_at"])

    if "rfq_items" not in tables:
        op.create_table(
            "rfq_items",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column(
                "rfq_id", sa.String(), sa.ForeignKey("rfqs.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column(
                "source_request_item_id", sa.String(),
                sa.ForeignKey("incoming_purchase_request_items.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "item_id", sa.String(), sa.ForeignKey("items.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("product_name", sa.String(), nullable=False),
            sa.Column("specifications", sa.Text(), nullable=False, server_default=""),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("unit", sa.String(), nullable=False, server_default=""),
        )
        op.create_index("ix_rfq_items_rfq", "rfq_items", ["rfq_id"])

    if "rfq_suppliers" not in tables:
        op.create_table(
            "rfq_suppliers",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column(
                "rfq_id", sa.String(), sa.ForeignKey("rfqs.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "supplier_id", sa.String(),
                sa.ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True,
            ),
            sa.Column("supplier_name", sa.String(), nullable=False, server_default=""),
            sa.Column("added_at", sa.String(), nullable=False),
            sa.UniqueConstraint("rfq_id", "supplier_id", name="uq_rfq_supplier"),
        )
        op.create_index("ix_rfq_suppliers_rfq", "rfq_suppliers", ["rfq_id"])

    if "supplier_quotations" not in tables:
        op.create_table(
            "supplier_quotations",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column(
                "rfq_id", sa.String(), sa.ForeignKey("rfqs.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "supplier_id", sa.String(),
                sa.ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True,
            ),
            sa.Column("supplier_name", sa.String(), nullable=False, server_default=""),
            sa.Column("quotation_ref", sa.String(), nullable=False, server_default=""),
            sa.Column("quotation_date", sa.String(), nullable=False, server_default=""),
            sa.Column("valid_until", sa.String(), nullable=False, server_default=""),
            sa.Column("payment_terms", sa.String(), nullable=False, server_default=""),
            sa.Column("delivery_terms", sa.String(), nullable=False, server_default=""),
            sa.Column("currency", sa.String(), nullable=False, server_default="EGP"),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(), nullable=False, server_default="draft"),
            sa.Column("created_by", sa.String(), nullable=False, server_default=""),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.Column("updated_at", sa.String(), nullable=False),
            sa.UniqueConstraint("rfq_id", "supplier_id", name="uq_rfq_supplier_quotation"),
        )
        op.create_index("ix_supplier_quotations_rfq", "supplier_quotations", ["rfq_id"])
        op.create_index("ix_supplier_quotations_status", "supplier_quotations", ["status"])

    if "supplier_quotation_lines" not in tables:
        op.create_table(
            "supplier_quotation_lines",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column(
                "quotation_id", sa.String(),
                sa.ForeignKey("supplier_quotations.id", ondelete="CASCADE"), nullable=False,
            ),
            sa.Column(
                "rfq_item_id", sa.String(),
                sa.ForeignKey("rfq_items.id", ondelete="SET NULL"), nullable=True,
            ),
            sa.Column("source_request_item_id", sa.String(), nullable=False, server_default=""),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("product_name", sa.String(), nullable=False, server_default=""),
            sa.Column("quantity", sa.Float(), nullable=False, server_default=sa.text("0")),
            sa.Column("unit", sa.String(), nullable=False, server_default=""),
            sa.Column("unit_price", sa.Float(), nullable=False, server_default=sa.text("0")),
            sa.Column("discount_pct", sa.Float(), nullable=False, server_default=sa.text("0")),
            sa.Column("tax_pct", sa.Float(), nullable=False, server_default=sa.text("0")),
            sa.Column("availability", sa.String(), nullable=False, server_default="available"),
            sa.Column("remark", sa.Text(), nullable=False, server_default=""),
            sa.UniqueConstraint("quotation_id", "rfq_item_id", name="uq_quotation_rfq_item"),
        )
        op.create_index(
            "ix_supplier_quotation_lines_quotation", "supplier_quotation_lines", ["quotation_id"],
        )

    if "supplier_quotation_attachments" not in tables:
        op.create_table(
            "supplier_quotation_attachments",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column(
                "quotation_id", sa.String(),
                sa.ForeignKey("supplier_quotations.id", ondelete="CASCADE"), nullable=False,
            ),
            sa.Column("original_filename", sa.String(), nullable=False),
            sa.Column("stored_filename", sa.String(), nullable=False),
            sa.Column("media_type", sa.String(), nullable=False),
            sa.Column("size_bytes", sa.Integer(), nullable=False),
            sa.Column("sha256", sa.String(), nullable=False),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.UniqueConstraint(
                "stored_filename", name="uq_supplier_quotation_attachments_stored_filename",
            ),
        )
        op.create_index(
            "ix_supplier_quotation_attachments_quotation",
            "supplier_quotation_attachments", ["quotation_id"],
        )


def downgrade() -> None:
    raise RuntimeError(
        "Destructive rfq-supplier-quotations downgrade is disabled; restore the verified pre-migration backup."
    )
