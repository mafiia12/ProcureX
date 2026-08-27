"""Move comparison commercial adjustments to supplier offers.

Revision ID: 0018_supplier_offer_adjustments
Revises: 0017_corrected_request_ancestry
"""

from alembic import op
import sqlalchemy as sa


revision = "0018_supplier_offer_adjustments"
down_revision = "0017_corrected_request_ancestry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "price_comparison_supplier_offers" not in tables:
        op.create_table(
            "price_comparison_supplier_offers",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column(
                "comparison_id", sa.String(),
                sa.ForeignKey("price_comparisons.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "supplier_id", sa.String(),
                sa.ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True,
            ),
            sa.Column("supplier_code", sa.String(), nullable=False),
            sa.Column("supplier_name", sa.String(), nullable=False),
            sa.Column("discount_pct", sa.Float(), nullable=False, server_default=sa.text("0")),
            sa.Column("tax_pct", sa.Float(), nullable=False, server_default=sa.text("0")),
            sa.Column("shipping_cost", sa.Float(), nullable=False, server_default=sa.text("0")),
            sa.Column("other_cost", sa.Float(), nullable=False, server_default=sa.text("0")),
            sa.UniqueConstraint(
                "comparison_id", "supplier_code",
                name="uq_price_comparison_supplier_offer",
            ),
        )
        op.create_index(
            "ix_price_comparison_supplier_offers_comparison",
            "price_comparison_supplier_offers", ["comparison_id"],
        )

    if "engineer_approval_supplier_offers" not in tables:
        op.create_table(
            "engineer_approval_supplier_offers",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column(
                "approval_id", sa.String(),
                sa.ForeignKey("engineer_approvals.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("supplier_id", sa.String(), nullable=False, server_default=""),
            sa.Column("supplier_name", sa.String(), nullable=False, server_default=""),
            sa.Column("discount_pct", sa.Float(), nullable=False, server_default=sa.text("0")),
            sa.Column("tax_pct", sa.Float(), nullable=False, server_default=sa.text("0")),
            sa.Column("shipping_cost", sa.Float(), nullable=False, server_default=sa.text("0")),
            sa.Column("other_cost", sa.Float(), nullable=False, server_default=sa.text("0")),
            sa.UniqueConstraint(
                "approval_id", "supplier_id", name="uq_approval_supplier_offer",
            ),
        )
        op.create_index(
            "ix_approval_supplier_offers_approval",
            "engineer_approval_supplier_offers", ["approval_id"],
        )
        op.create_index(
            "ix_price_comparison_supplier_offers_supplier",
            "price_comparison_supplier_offers", ["supplier_id"],
        )

    # Preserve the exact effective legacy discount/VAT and count every legacy
    # shipping/other amount once in the new supplier-offer record.
    op.execute(sa.text("""
        INSERT INTO price_comparison_supplier_offers (
            id, comparison_id, supplier_id, supplier_code, supplier_name,
            discount_pct, tax_pct, shipping_cost, other_cost
        )
        SELECT
            r.comparison_id || ':' || r.supplier_code,
            r.comparison_id, MAX(r.supplier_id), r.supplier_code,
            MAX(r.supplier_name),
            CASE WHEN SUM(CASE WHEN r.availability = 'available'
                AND r.quantity > 0 AND r.unit_price > 0
                AND (r.price_valid_until = '' OR r.price_valid_until >= c.comparison_date)
                THEN r.quantity * r.unit_price ELSE 0 END) = 0 THEN 0 ELSE
                100 * SUM(CASE WHEN r.availability = 'available'
                AND r.quantity > 0 AND r.unit_price > 0
                AND (r.price_valid_until = '' OR r.price_valid_until >= c.comparison_date)
                THEN r.quantity * r.unit_price * r.discount_pct / 100 ELSE 0 END)
                / SUM(CASE WHEN r.availability = 'available'
                AND r.quantity > 0 AND r.unit_price > 0
                AND (r.price_valid_until = '' OR r.price_valid_until >= c.comparison_date)
                THEN r.quantity * r.unit_price ELSE 0 END) END,
            CASE WHEN SUM(CASE WHEN r.availability = 'available'
                AND r.quantity > 0 AND r.unit_price > 0
                AND (r.price_valid_until = '' OR r.price_valid_until >= c.comparison_date)
                THEN r.quantity * r.unit_price * (1 - r.discount_pct / 100) ELSE 0 END) = 0
                THEN 0 ELSE 100 * SUM(CASE WHEN r.availability = 'available'
                AND r.quantity > 0 AND r.unit_price > 0
                AND (r.price_valid_until = '' OR r.price_valid_until >= c.comparison_date)
                THEN r.quantity * r.unit_price * (1 - r.discount_pct / 100) * r.tax_pct / 100 ELSE 0 END)
                / SUM(CASE WHEN r.availability = 'available'
                AND r.quantity > 0 AND r.unit_price > 0
                AND (r.price_valid_until = '' OR r.price_valid_until >= c.comparison_date)
                THEN r.quantity * r.unit_price * (1 - r.discount_pct / 100) ELSE 0 END) END,
            SUM(CASE WHEN r.availability = 'available' AND r.quantity > 0 AND r.unit_price > 0
                AND (r.price_valid_until = '' OR r.price_valid_until >= c.comparison_date)
                THEN r.shipping_cost ELSE 0 END),
            SUM(CASE WHEN r.availability = 'available' AND r.quantity > 0 AND r.unit_price > 0
                AND (r.price_valid_until = '' OR r.price_valid_until >= c.comparison_date)
                THEN r.other_cost ELSE 0 END)
        FROM price_comparison_rows r
        JOIN price_comparisons c ON c.id = r.comparison_id
        WHERE r.supplier_code <> ''
          AND NOT EXISTS (
            SELECT 1 FROM price_comparison_supplier_offers o
            WHERE o.comparison_id = r.comparison_id
              AND o.supplier_code = r.supplier_code
          )
        GROUP BY r.comparison_id, r.supplier_code
    """))


def downgrade() -> None:
    raise RuntimeError(
        "Destructive supplier-offer downgrade is disabled; restore a verified backup."
    )
