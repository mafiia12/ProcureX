"""Isolated supplier price-comparison module with no purchasing workflow side effects."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from io import BytesIO
from math import isfinite
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from pydantic import BaseModel, Field
from sqlalchemy import (
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    delete,
    func,
    select,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

try:
    from .commercial_totals import calculate_supplier_total
    from .auth.models import User
    from .auth.service import require_erp_role
    from .business_codes import reserve_code
    from .database import (
        Base,
        Customer,
        Item,
        PriceHistory,
        Project,
        SessionLocal,
        Supplier,
    )
    from .rfq import latest_formal_price_by_item_supplier
except ImportError:
    from commercial_totals import calculate_supplier_total
    from auth.models import User
    from auth.service import require_erp_role
    from business_codes import reserve_code
    from database import (
        Base,
        Customer,
        Item,
        PriceHistory,
        Project,
        SessionLocal,
        Supplier,
    )
    from rfq import latest_formal_price_by_item_supplier


router = APIRouter(prefix="/price-comparisons", tags=["supplier-price-comparisons"])


class PriceComparison(Base):
    __tablename__ = "price_comparisons"
    __table_args__ = (
        Index("ix_price_comparisons_number", "comparison_number", unique=True),
        Index("ix_price_comparisons_date", "comparison_date"),
        Index("ix_price_comparisons_project", "project_id"),
        Index("ix_price_comparisons_customer", "customer_id"),
        Index("ix_price_comparisons_updated", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    comparison_number: Mapped[str] = mapped_column(String, unique=True)
    project_id: Mapped[Optional[str]] = mapped_column(
        String,
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    project_name: Mapped[str] = mapped_column(String, default="", server_default="")
    customer_id: Mapped[Optional[str]] = mapped_column(
        String,
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
    )
    customer_name: Mapped[str] = mapped_column(String, default="", server_default="")
    source_request_id: Mapped[str] = mapped_column(
        String, default="", server_default=""
    )
    source_request_number: Mapped[str] = mapped_column(
        String, default="", server_default=""
    )
    comparison_date: Mapped[str] = mapped_column(String)
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[str] = mapped_column(String)
    updated_at: Mapped[str] = mapped_column(String)


class PriceComparisonRow(Base):
    __tablename__ = "price_comparison_rows"
    __table_args__ = (
        UniqueConstraint(
            "comparison_id",
            "item_id",
            "supplier_id",
            name="uq_price_comparison_item_supplier",
        ),
        Index("ix_price_comparison_rows_comparison", "comparison_id"),
        Index("ix_price_comparison_rows_item", "item_id"),
        Index("ix_price_comparison_rows_supplier", "supplier_id"),
        Index("ix_price_comparison_rows_availability", "availability"),
        Index("ix_price_comparison_rows_item_supplier", "item_id", "supplier_id"),
        Index("ix_price_comparison_rows_product_name", "product_name"),
        Index("ix_price_comparison_rows_supplier_name", "supplier_name"),
        Index(
            "ix_price_comparison_rows_comparison_position", "comparison_id", "position"
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    comparison_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("price_comparisons.id", ondelete="CASCADE"),
    )
    position: Mapped[int] = mapped_column(Integer)
    item_id: Mapped[Optional[str]] = mapped_column(
        String,
        ForeignKey("items.id", ondelete="SET NULL"),
        nullable=True,
    )
    item_code: Mapped[str] = mapped_column(String)
    product_name: Mapped[str] = mapped_column(String)
    brand: Mapped[str] = mapped_column(String, default="", server_default="")
    main_category: Mapped[str] = mapped_column(String, default="", server_default="")
    subcategory: Mapped[str] = mapped_column(String, default="", server_default="")
    specifications: Mapped[str] = mapped_column(Text, default="", server_default="")
    unit: Mapped[str] = mapped_column(String, default="", server_default="")
    supplier_id: Mapped[Optional[str]] = mapped_column(
        String,
        ForeignKey("suppliers.id", ondelete="SET NULL"),
        nullable=True,
    )
    supplier_code: Mapped[str] = mapped_column(String)
    supplier_name: Mapped[str] = mapped_column(String)
    quantity: Mapped[float] = mapped_column(Float)
    unit_price: Mapped[float] = mapped_column(Float, default=0, server_default=text("0"))
    discount_pct: Mapped[float] = mapped_column(Float, default=0, server_default=text("0"))
    tax_pct: Mapped[float] = mapped_column(Float, default=0, server_default=text("0"))
    shipping_cost: Mapped[float] = mapped_column(Float, default=0, server_default=text("0"))
    other_cost: Mapped[float] = mapped_column(Float, default=0, server_default=text("0"))
    delivery_days: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    payment_terms: Mapped[str] = mapped_column(String, default="", server_default="")
    availability: Mapped[str] = mapped_column(
        String, default="available", server_default="available"
    )
    price_valid_until: Mapped[str] = mapped_column(
        String, default="", server_default=""
    )
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    selected_for_purchase: Mapped[int] = mapped_column(
        Integer,
        default=0,
        server_default=text("0"),
    )


class PriceComparisonSupplierOffer(Base):
    __tablename__ = "price_comparison_supplier_offers"
    __table_args__ = (
        UniqueConstraint(
            "comparison_id", "supplier_code",
            name="uq_price_comparison_supplier_offer",
        ),
        Index("ix_price_comparison_supplier_offers_comparison", "comparison_id"),
        Index("ix_price_comparison_supplier_offers_supplier", "supplier_id"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    comparison_id: Mapped[str] = mapped_column(
        String, ForeignKey("price_comparisons.id", ondelete="CASCADE"),
    )
    supplier_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True,
    )
    supplier_code: Mapped[str] = mapped_column(String)
    supplier_name: Mapped[str] = mapped_column(String)
    discount_pct: Mapped[float] = mapped_column(Float, default=0, server_default=text("0"))
    tax_pct: Mapped[float] = mapped_column(Float, default=0, server_default=text("0"))
    shipping_cost: Mapped[float] = mapped_column(Float, default=0, server_default=text("0"))
    other_cost: Mapped[float] = mapped_column(Float, default=0, server_default=text("0"))


class ComparisonRowIn(BaseModel):
    id: Optional[str] = None
    item_id: str = ""
    item_code: str = Field(default="", max_length=200)
    product_name: str = Field(default="", max_length=300)
    brand: str = Field(default="", max_length=200)
    main_category: str = Field(default="", max_length=200)
    subcategory: str = Field(default="", max_length=200)
    specifications: str = Field(default="", max_length=4000)
    supplier_id: str = ""
    supplier_code: str = Field(default="", max_length=200)
    supplier_name: str = Field(default="", max_length=300)
    quantity: float = Field(gt=0, le=1_000_000_000)
    unit: str = Field(default="", max_length=50)
    unit_price: float = Field(default=0, ge=0, le=1_000_000_000_000)
    discount_pct: float = Field(default=0, ge=0, le=100)
    tax_pct: float = Field(default=0, ge=0, le=100)
    shipping_cost: float = Field(default=0, ge=0, le=1_000_000_000_000)
    other_cost: float = Field(default=0, ge=0, le=1_000_000_000_000)
    delivery_days: int = Field(default=0, ge=0, le=100_000)
    payment_terms: str = Field(default="", max_length=300)
    availability: Literal["available", "unavailable"] = "available"
    price_valid_until: str = Field(default="", max_length=10)
    notes: str = Field(default="", max_length=2000)
    selected_for_purchase: int = Field(default=0, ge=0, le=1)


class ComparisonSupplierOfferIn(BaseModel):
    supplier_id: str = ""
    supplier_code: str = Field(default="", max_length=200)
    supplier_name: str = Field(default="", max_length=300)
    discount_pct: float = Field(default=0, ge=0, le=100)
    tax_pct: float = Field(default=0, ge=0, le=100)
    shipping_cost: float = Field(default=0, ge=0, le=1_000_000_000_000)
    other_cost: float = Field(default=0, ge=0, le=1_000_000_000_000)


class ComparisonIn(BaseModel):
    project_id: str = ""
    project_name: str = Field(default="", max_length=200)
    customer_id: str = ""
    customer_name: str = Field(default="", max_length=200)
    source_request_id: str = Field(default="", max_length=100)
    source_request_number: str = Field(default="", max_length=100)
    comparison_date: str = Field(min_length=10, max_length=10)
    notes: str = Field(default="", max_length=4000)
    rows: list[ComparisonRowIn] = Field(min_length=1, max_length=2000)
    supplier_offers: list[ComparisonSupplierOfferIn] = Field(
        default_factory=list, max_length=500,
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _manual_key(prefix: str, *parts: str) -> str:
    identity = "|".join(str(part or "").strip().casefold() for part in parts)
    return f"MANUAL-{prefix}-{uuid.uuid5(uuid.NAMESPACE_URL, identity)}"


def _round(value: float) -> float:
    return round(_number(value) + 1e-12, 2)


_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def _number(value) -> float:
    """Return an unformatted finite number for every comparison operation."""
    if value is None or value == "":
        return 0.0
    if isinstance(value, str):
        value = (
            value.translate(_ARABIC_DIGITS)
            .strip()
            .replace("٬", "")
            .replace(",", "")
            .replace("٫", ".")
            .replace(" ", "")
        )
    try:
        result = float(value)
    except (TypeError, ValueError):
        return 0.0
    return result if isfinite(result) else 0.0


def _ascending_number(field: str):
    return lambda row: _number(row.get(field))


def _lowest_by(rows: list[dict], field: str) -> Optional[dict]:
    """Select the first tied row after an explicit numeric ascending sort."""
    return sorted(rows, key=_ascending_number(field))[0] if rows else None


def _offer_is_complete(row) -> bool:
    has_supplier = bool(
        row.get("supplier_id")
        or row.get("supplier_code")
        or str(row.get("supplier_name") or "").strip()
    )
    return (
        has_supplier
        and _number(row.get("quantity")) > 0
        and _number(row.get("unit_price")) > 0
        and row.get("availability") in {"available", "unavailable"}
    )


def _supplier_key(row) -> str:
    return str(
        row.get("supplier_id")
        or row.get("supplier_code")
        or row.get("manual_supplier_key")
        or row.get("supplier_name")
        or ""
    )


def _legacy_supplier_offers(comparison_date: str, rows: list[dict]) -> list[dict]:
    """Translate legacy per-line adjustments without changing historical totals."""
    groups: dict[str, list[dict]] = {}
    for row in rows:
        key = _supplier_key(row)
        if key:
            groups.setdefault(key, []).append(row)
    offers = []
    for group_rows in groups.values():
        eligible = [
            row for row in group_rows
            if _offer_is_complete(row)
            and row.get("availability") == "available"
            and not (
                row.get("price_valid_until")
                and row.get("price_valid_until") < comparison_date
            )
        ]
        subtotal = sum(
            _number(row.get("quantity")) * _number(row.get("unit_price"))
            for row in eligible
        )
        discount = sum(
            _number(row.get("quantity")) * _number(row.get("unit_price"))
            * _number(row.get("discount_pct")) / 100
            for row in eligible
        )
        taxable = subtotal - discount
        tax = sum(
            _number(row.get("quantity")) * _number(row.get("unit_price"))
            * (1 - _number(row.get("discount_pct")) / 100)
            * _number(row.get("tax_pct")) / 100
            for row in eligible
        )
        first = group_rows[0]
        supplier_id = first.get("supplier_id") or ""
        supplier_name = first.get("supplier_name") or ""
        offers.append({
            "supplier_id": supplier_id,
            "supplier_code": first.get("supplier_code") or (
                _manual_key("SUPPLIER", supplier_name)
                if not supplier_id and supplier_name else ""
            ),
            "supplier_name": supplier_name,
            "discount_pct": discount / subtotal * 100 if subtotal else 0,
            "tax_pct": tax / taxable * 100 if taxable else 0,
            "shipping_cost": sum(
                _number(row.get("shipping_cost")) for row in eligible
            ),
            "other_cost": sum(_number(row.get("other_cost")) for row in eligible),
        })
    return offers


def _next_comparison_number() -> str:
    return reserve_code(
        "price_comparisons",
        "CMP-",
        6,
        ("CMP-",),
        PriceComparison,
        PriceComparison.comparison_number,
    )


def _last_prices(session, item_codes: set[str]) -> dict[str, float]:
    if not item_codes:
        return {}
    rows = session.scalars(
        select(PriceHistory)
        .where(PriceHistory.item_code.in_(item_codes))
        .order_by(PriceHistory.item_code, PriceHistory.date)
    ).all()
    result = {}
    for row in rows:
        result[row.item_code] = float(row.unit_price or 0)
    return result


def calculate_comparison(
    comparison_date: str,
    rows: list[dict],
    last_prices: Optional[dict[str, float]] = None,
    supplier_offers: Optional[list[dict]] = None,
) -> dict:
    """Return product, supplier, delivery, availability, and mixed-buy summaries."""
    last_prices = last_prices or {}
    normalized_offers = (
        [dict(offer) for offer in supplier_offers]
        if supplier_offers is not None
        else _legacy_supplier_offers(comparison_date, rows)
    )
    offers_by_supplier = {
        _supplier_key(offer): offer for offer in normalized_offers
        if _supplier_key(offer)
    }
    calculated_rows = []
    for source in rows:
        row = dict(source)
        subtotal = _number(row.get("quantity")) * _number(row.get("unit_price"))
        for legacy_field in (
            "discount_pct", "tax_pct", "shipping_cost", "other_cost",
        ):
            row.pop(legacy_field, None)
        valid_until = row.get("price_valid_until") or ""
        is_expired = bool(valid_until and valid_until < comparison_date)
        is_missing_price = _number(row.get("unit_price")) <= 0
        is_unavailable = row.get("availability") != "available"
        is_incomplete = not _offer_is_complete(row)
        row.update(
            {
                "subtotal": _round(subtotal),
                "final_total": _round(subtotal),
                "is_expired": is_expired,
                "is_missing_price": is_missing_price,
                "is_unavailable": is_unavailable,
                "is_incomplete": is_incomplete,
                "eligible": not (is_incomplete or is_expired or is_unavailable),
                "last_historical_unit_price": last_prices.get(row.get("item_code")),
                "difference_from_last_price": None,
                "difference_pct_from_last_price": None,
                "difference_from_lowest": None,
                "difference_pct_from_lowest": None,
                "is_lowest_final_total": False,
                "is_fastest_delivery": False,
            }
        )
        last_price = row["last_historical_unit_price"]
        if last_price is not None:
            historical_difference = _number(row.get("unit_price")) - _number(last_price)
            row["difference_from_last_price"] = _round(historical_difference)
            row["difference_pct_from_last_price"] = (
                _round(historical_difference / _number(last_price) * 100)
                if _number(last_price)
                else 0
            )
        calculated_rows.append(row)

    product_groups: dict[str, list[dict]] = {}
    for row in calculated_rows:
        product_groups.setdefault(
            str(row.get("item_id") or row.get("item_code")), []
        ).append(row)

    product_summaries = []
    for group_rows in product_groups.values():
        eligible = [row for row in group_rows if row["eligible"]]
        lowest_unit_offer = _lowest_by(eligible, "unit_price")
        lowest_final_offer = _lowest_by(eligible, "final_total")
        fastest_offer = _lowest_by(eligible, "delivery_days")
        lowest_unit = (
            _number(lowest_unit_offer["unit_price"]) if lowest_unit_offer else None
        )
        lowest_final = (
            _number(lowest_final_offer["final_total"]) if lowest_final_offer else None
        )
        fastest = (
            int(_number(fastest_offer["delivery_days"])) if fastest_offer else None
        )
        for row in group_rows:
            if lowest_final is not None and row["eligible"]:
                difference = _number(row["final_total"]) - _number(lowest_final)
                row["difference_from_lowest"] = _round(difference)
                row["difference_pct_from_lowest"] = (
                    _round(difference / _number(lowest_final) * 100)
                    if _number(lowest_final)
                    else 0
                )
            row["is_lowest_final_total"] = bool(
                row["eligible"]
                and lowest_final is not None
                and abs(_number(row["final_total"]) - _number(lowest_final)) < 0.005
            )
            row["is_fastest_delivery"] = bool(
                row["eligible"]
                and fastest is not None
                and _number(row["delivery_days"]) == _number(fastest)
            )
        first = group_rows[0]
        historical_price = next(
            (
                row["last_historical_unit_price"]
                for row in group_rows
                if row["last_historical_unit_price"] is not None
            ),
            None,
        )
        historical_difference = (
            _round(lowest_unit - _number(historical_price))
            if lowest_unit is not None and historical_price is not None
            else None
        )
        product_summaries.append(
            {
                "item_id": first.get("item_id"),
                "item_code": first.get("item_code"),
                "product_name": first.get("product_name"),
                "brand": first.get("brand"),
                "lowest_unit_price": (
                    _round(lowest_unit) if lowest_unit is not None else None
                ),
                "lowest_final_total": (
                    _round(lowest_final) if lowest_final is not None else None
                ),
                "fastest_delivery_days": fastest,
                "lowest_unit_price_supplier": (
                    lowest_unit_offer["supplier_name"] if lowest_unit_offer else None
                ),
                "lowest_final_total_supplier": (
                    lowest_final_offer["supplier_name"] if lowest_final_offer else None
                ),
                "fastest_delivery_supplier": (
                    fastest_offer["supplier_name"] if fastest_offer else None
                ),
                "last_historical_unit_price": historical_price,
                "difference_from_last_price": historical_difference,
                "difference_pct_from_last_price": (
                    _round(historical_difference / _number(historical_price) * 100)
                    if historical_difference is not None and _number(historical_price)
                    else None
                ),
                "available_offer_count": len(
                    [row for row in group_rows if row["eligible"]]
                ),
            }
        )

    all_products = set(product_groups)
    supplier_groups: dict[str, list[dict]] = {}
    for row in calculated_rows:
        if row["is_incomplete"]:
            continue
        supplier_groups.setdefault(
            str(row.get("supplier_id") or row.get("supplier_code")), []
        ).append(row)

    supplier_summaries = []
    for group_rows in supplier_groups.values():
        eligible = [row for row in group_rows if row["eligible"]]
        available_products = {
            str(row.get("item_id") or row.get("item_code"))
            for row in group_rows
            if row["eligible"]
        }
        eligible_products = {
            str(row.get("item_id") or row.get("item_code")) for row in eligible
        }
        first = group_rows[0]
        offer = offers_by_supplier.get(_supplier_key(first), {})
        offer_totals = calculate_supplier_total(
            sum(_number(row["subtotal"]) for row in eligible),
            offer.get("discount_pct"),
            offer.get("tax_pct"),
            offer.get("shipping_cost"),
            offer.get("other_cost"),
        )
        summary = {
            "supplier_id": first.get("supplier_id"),
            "supplier_code": first.get("supplier_code"),
            "supplier_name": first.get("supplier_name"),
            "products_quoted": len(
                {str(row.get("item_id") or row.get("item_code")) for row in group_rows}
            ),
            "unavailable_products": len(
                [row for row in group_rows if row["is_unavailable"]]
            ),
            "available_products": len(available_products),
            "discount_pct": _number(offer.get("discount_pct")),
            "tax_pct": _number(offer.get("tax_pct")),
            "shipping_cost": _number(offer.get("shipping_cost")),
            "other_cost": _number(offer.get("other_cost")),
            **offer_totals,
            "maximum_delivery_days": (
                int(max(_number(row["delivery_days"]) for row in eligible))
                if eligible
                else None
            ),
            "availability_pct": _round(
                len(available_products) / len(all_products) * 100 if all_products else 0
            ),
            "is_complete": eligible_products == all_products and bool(all_products),
            "difference_from_lowest_complete": None,
            "difference_pct_from_lowest_complete": None,
        }
        supplier_summaries.append(summary)

    complete = [summary for summary in supplier_summaries if summary["is_complete"]]
    cheapest_complete = _lowest_by(complete, "final_offer_total")
    lowest_complete = (
        _number(cheapest_complete["final_offer_total"]) if cheapest_complete else None
    )
    for summary in complete:
        difference = _number(summary["final_offer_total"]) - _number(lowest_complete)
        summary["difference_from_lowest_complete"] = _round(difference)
        summary["difference_pct_from_lowest_complete"] = (
            _round(difference / _number(lowest_complete) * 100)
            if _number(lowest_complete)
            else 0
        )

    fastest_complete = _lowest_by(
        [row for row in complete if row["maximum_delivery_days"] is not None],
        "maximum_delivery_days",
    )
    highest_availability = max(
        supplier_summaries, key=lambda row: row["availability_pct"], default=None
    )
    mixed_rows = []
    for group_rows in product_groups.values():
        eligible = [row for row in group_rows if row["eligible"]]
        lowest_offer = _lowest_by(eligible, "final_total")
        if lowest_offer:
            mixed_rows.append(lowest_offer)
    mixed_groups: dict[str, list[dict]] = {}
    for row in mixed_rows:
        mixed_groups.setdefault(_supplier_key(row), []).append(row)
    mixed_total = _round(sum(
        calculate_supplier_total(
            sum(_number(row["subtotal"]) for row in selected_rows),
            offers_by_supplier.get(key, {}).get("discount_pct"),
            offers_by_supplier.get(key, {}).get("tax_pct"),
            offers_by_supplier.get(key, {}).get("shipping_cost"),
            offers_by_supplier.get(key, {}).get("other_cost"),
        )["final_offer_total"]
        for key, selected_rows in mixed_groups.items()
    ))
    single_total = cheapest_complete["final_offer_total"] if cheapest_complete else None
    savings = _round(single_total - mixed_total) if single_total is not None else None
    mixed_supplier_count = len(
        {str(row.get("supplier_id") or row.get("supplier_code")) for row in mixed_rows}
    )

    return {
        "rows": calculated_rows,
        "supplier_offers": normalized_offers,
        "product_summaries": product_summaries,
        "supplier_summaries": supplier_summaries,
        "scenario_summary": {
            "cheapest_complete_supplier": cheapest_complete,
            "fastest_complete_supplier": fastest_complete,
            "highest_availability_supplier": highest_availability,
            "single_supplier_total": single_total,
            "mixed_supplier_total": mixed_total,
            "mixed_supplier_count": mixed_supplier_count,
            "mixed_supplier_selections": [
                {
                    "item_id": row.get("item_id"),
                    "product_name": row.get("product_name"),
                    "supplier_id": row.get("supplier_id"),
                    "supplier_name": row.get("supplier_name"),
                    "final_total": row.get("final_total"),
                }
                for row in mixed_rows
            ],
            "savings_amount": savings,
            "savings_pct": (
                _round(savings / single_total * 100)
                if savings is not None and single_total
                else None
            ),
        },
        "delivery_comparison": [
            {
                "supplier_id": row["supplier_id"],
                "supplier_name": row["supplier_name"],
                "maximum_delivery_days": row["maximum_delivery_days"],
                "is_complete": row["is_complete"],
            }
            for row in supplier_summaries
        ],
        "availability_comparison": [
            {
                "supplier_id": row["supplier_id"],
                "supplier_name": row["supplier_name"],
                "availability_pct": row["availability_pct"],
                "unavailable_products": row["unavailable_products"],
            }
            for row in supplier_summaries
        ],
    }


def _row_document(row: PriceComparisonRow) -> dict:
    return {
        column.name: getattr(row, column.name)
        for column in PriceComparisonRow.__table__.columns
    }


def _offer_document(offer: PriceComparisonSupplierOffer) -> dict:
    return {
        column.name: getattr(offer, column.name)
        for column in PriceComparisonSupplierOffer.__table__.columns
    }


def _detail(session, comparison: PriceComparison) -> dict:
    rows = session.scalars(
        select(PriceComparisonRow)
        .where(PriceComparisonRow.comparison_id == comparison.id)
        .order_by(PriceComparisonRow.position)
    ).all()
    row_documents = [_row_document(row) for row in rows]
    offers = session.scalars(
        select(PriceComparisonSupplierOffer)
        .where(PriceComparisonSupplierOffer.comparison_id == comparison.id)
        .order_by(PriceComparisonSupplierOffer.supplier_name)
    ).all()
    calculations = calculate_comparison(
        comparison.comparison_date,
        row_documents,
        _last_prices(session, {row.item_code for row in rows}),
        [_offer_document(offer) for offer in offers] or None,
    )
    source_attachments = []
    source_rfq_id = ""
    supplier_quotations = []
    if comparison.source_request_id:
        try:
            from .incoming_requests import IncomingPurchaseRequestItem, IncomingRequestAttachment
        except ImportError:  # pragma: no cover
            from incoming_requests import IncomingPurchaseRequestItem, IncomingRequestAttachment
        attachment_rows = session.execute(
            select(IncomingRequestAttachment, IncomingPurchaseRequestItem)
            .join(
                IncomingPurchaseRequestItem,
                IncomingPurchaseRequestItem.id == IncomingRequestAttachment.request_item_id,
            )
            .where(IncomingPurchaseRequestItem.request_id == comparison.source_request_id)
            .order_by(IncomingPurchaseRequestItem.position)
        ).all()
        source_attachments = [{
            "id": attachment.id,
            "request_item_id": item.id,
            "item_label": item.product_name,
            "original_filename": attachment.original_filename,
            "media_type": attachment.media_type,
            "size_bytes": attachment.size_bytes,
            "is_image": attachment.media_type.startswith("image/"),
            "view_url": (
                f"/internal/incoming-purchase-requests/{comparison.source_request_id}"
                f"/attachments/{attachment.id}"
            ),
        } for attachment, item in attachment_rows]
        try:
            from .rfq import RequestForQuotation, SupplierQuotation, _quotation_summary
        except ImportError:  # pragma: no cover
            from rfq import RequestForQuotation, SupplierQuotation, _quotation_summary
        source_rfq = session.scalar(
            select(RequestForQuotation)
            .where(RequestForQuotation.source_request_id == comparison.source_request_id)
            .order_by(RequestForQuotation.created_at.desc())
            .limit(1)
        )
        if source_rfq:
            source_rfq_id = source_rfq.id
            supplier_quotations = [
                _quotation_summary(session, quotation)
                for quotation in session.scalars(
                    select(SupplierQuotation)
                    .where(SupplierQuotation.rfq_id == source_rfq.id)
                    .order_by(SupplierQuotation.created_at)
                ).all()
            ]
    return {
        "id": comparison.id,
        "comparison_number": comparison.comparison_number,
        "project_id": comparison.project_id or "",
        "project_name": comparison.project_name,
        "customer_id": comparison.customer_id or "",
        "customer_name": comparison.customer_name,
        "source_request_id": comparison.source_request_id,
        "source_request_number": comparison.source_request_number,
        "source_attachments": source_attachments,
        "source_rfq_id": source_rfq_id,
        "supplier_quotations": supplier_quotations,
        "comparison_date": comparison.comparison_date,
        "notes": comparison.notes,
        "created_at": comparison.created_at,
        "updated_at": comparison.updated_at,
        **calculations,
    }


def _references(session, body: ComparisonIn):
    project = session.get(Project, body.project_id) if body.project_id else None
    customer = session.get(Customer, body.customer_id) if body.customer_id else None
    if body.project_id and not project:
        raise HTTPException(422, "المشروع المحدد غير موجود")
    if body.customer_id and not customer:
        raise HTTPException(422, "العميل المحدد غير موجود")
    item_ids = {row.item_id for row in body.rows if row.item_id}
    supplier_ids = {row.supplier_id for row in body.rows if row.supplier_id} | {
        offer.supplier_id for offer in body.supplier_offers if offer.supplier_id
    }
    items = {
        item.id: item
        for item in session.scalars(select(Item).where(Item.id.in_(item_ids))).all()
    }
    suppliers = {
        supplier.id: supplier
        for supplier in session.scalars(
            select(Supplier).where(Supplier.id.in_(supplier_ids))
        ).all()
    }
    missing_items = item_ids - set(items)
    missing_suppliers = supplier_ids - set(suppliers)
    if missing_items:
        raise HTTPException(422, "يوجد منتج محدد غير موجود")
    if missing_suppliers:
        raise HTTPException(422, "يوجد مورد محدد غير موجود")
    for row in body.rows:
        if not row.item_id and not row.product_name.strip():
            raise HTTPException(422, "اسم المنتج اليدوي مطلوب")
        if body.source_request_id and not row.supplier_id:
            raise HTTPException(422, "يجب اختيار مورد فعلي من سجل الموردين لكل عرض")
        row_document = row.model_dump()
        if row.selected_for_purchase and (
            not _offer_is_complete(row_document)
            or row.availability != "available"
            or bool(row.price_valid_until and row.price_valid_until < body.comparison_date)
        ):
            raise HTTPException(422, "لا يمكن اختيار عرض غير مكتمل أو غير صالح للشراء")
    combinations = [
        (
            row.item_id
            or row.item_code.strip()
            or _manual_key(
                "ITEM",
                row.product_name,
                row.brand,
                row.main_category,
                row.subcategory,
                row.specifications,
            ),
            row.supplier_id or _manual_key("SUPPLIER", row.supplier_name),
        )
        for row in body.rows
        if row.supplier_id or row.supplier_name.strip()
    ]
    if len(combinations) != len(set(combinations)):
        raise HTTPException(422, "لا يمكن تكرار نفس المنتج والمورد داخل المقارنة")
    selected_products = [
        row.item_id
        or row.item_code.strip()
        or _manual_key(
            "ITEM",
            row.product_name,
            row.brand,
            row.main_category,
            row.subcategory,
            row.specifications,
        )
        for row in body.rows
        if row.selected_for_purchase
    ]
    if len(selected_products) != len(set(selected_products)):
        raise HTTPException(422, "يمكن اختيار عرض واحد فقط لكل منتج")
    row_supplier_keys = {
        row.supplier_id or row.supplier_code.strip()
        or _manual_key("SUPPLIER", row.supplier_name)
        for row in body.rows if row.supplier_id or row.supplier_name.strip()
    }
    offer_supplier_keys = [
        offer.supplier_id or offer.supplier_code.strip()
        or _manual_key("SUPPLIER", offer.supplier_name)
        for offer in body.supplier_offers
    ]
    if len(offer_supplier_keys) != len(set(offer_supplier_keys)):
        raise HTTPException(422, "لا يمكن تكرار تعديلات نفس عرض المورد")
    if set(offer_supplier_keys) - row_supplier_keys:
        raise HTTPException(422, "تعديلات عرض المورد يجب أن ترتبط ببنود داخل المقارنة")
    return project, customer, items, suppliers


def _source_request(session, request_id: str):
    if not request_id:
        return None
    try:
        from .incoming_requests import IncomingPurchaseRequest
    except ImportError:  # pragma: no cover
        from incoming_requests import IncomingPurchaseRequest
    request_row = session.get(IncomingPurchaseRequest, request_id)
    if not request_row:
        raise HTTPException(404, "طلب الشراء المصدر غير موجود")
    return request_row


def _replace_rows(
    session,
    comparison: PriceComparison,
    body: ComparisonIn,
    items: dict[str, Item],
    suppliers: dict[str, Supplier],
) -> None:
    session.execute(delete(PriceComparisonRow).where(
        PriceComparisonRow.comparison_id == comparison.id
    ))
    session.flush()
    for position, source in enumerate(body.rows, start=1):
        item = items.get(source.item_id)
        supplier = suppliers.get(source.supplier_id)
        item_code = (
            source.item_code.strip() or item.code
            if item
            else source.item_code.strip() or _manual_key(
                "ITEM", source.product_name, source.brand, source.main_category,
                source.subcategory, source.specifications,
            )
        )
        supplier_code = (
            source.supplier_code.strip() or supplier.code
            if supplier
            else source.supplier_code.strip() or (
                _manual_key("SUPPLIER", source.supplier_name)
                if source.supplier_name.strip() else ""
            )
        )
        session.add(PriceComparisonRow(
            id=str(uuid.uuid4()), comparison_id=comparison.id, position=position,
            item_id=item.id if item else None, item_code=item_code,
            product_name=(
                source.product_name.strip() or item.product_name or item.name
                if item else source.product_name.strip()
            ),
            brand=source.brand.strip() or ((item.brand or "") if item else ""),
            main_category=(
                source.main_category.strip() or (item.main_category or item.category or "")
                if item else source.main_category.strip()
            ),
            subcategory=(
                source.subcategory.strip() or (item.subcategory or "")
                if item else source.subcategory.strip()
            ),
            specifications=(
                source.specifications.strip() or (item.specifications or item.specs or "")
                if item else source.specifications.strip()
            ),
            unit=source.unit or (item.unit if item else "") or "",
            supplier_id=supplier.id if supplier else None,
            supplier_code=supplier_code,
            supplier_name=(
                source.supplier_name.strip() or supplier.name
                if supplier else source.supplier_name.strip()
            ),
            quantity=source.quantity, unit_price=source.unit_price,
            # Legacy columns remain additive/backward-compatible only. New
            # comparisons store commercial adjustments on the supplier offer.
            discount_pct=0, tax_pct=0, shipping_cost=0, other_cost=0,
            delivery_days=source.delivery_days, payment_terms=source.payment_terms,
            availability=source.availability,
            price_valid_until=source.price_valid_until, notes=source.notes,
            selected_for_purchase=source.selected_for_purchase,
        ))


def _replace_supplier_offers(
    session,
    comparison: PriceComparison,
    body: ComparisonIn,
    suppliers: dict[str, Supplier],
) -> None:
    session.execute(delete(PriceComparisonSupplierOffer).where(
        PriceComparisonSupplierOffer.comparison_id == comparison.id
    ))
    session.flush()
    source_offers = [offer.model_dump() for offer in body.supplier_offers]
    if not source_offers:
        source_offers = _legacy_supplier_offers(
            body.comparison_date, [row.model_dump() for row in body.rows],
        )
    for source in source_offers:
        supplier = suppliers.get(source.get("supplier_id") or "")
        supplier_name = str(source.get("supplier_name") or "").strip() or (
            supplier.name if supplier else ""
        )
        supplier_code = str(source.get("supplier_code") or "").strip() or (
            supplier.code if supplier else ""
        ) or _manual_key("SUPPLIER", supplier_name)
        if not supplier_code:
            continue
        session.add(PriceComparisonSupplierOffer(
            id=str(uuid.uuid4()), comparison_id=comparison.id,
            supplier_id=supplier.id if supplier else None,
            supplier_code=supplier_code, supplier_name=supplier_name,
            discount_pct=_number(source.get("discount_pct")),
            tax_pct=_number(source.get("tax_pct")),
            shipping_cost=_number(source.get("shipping_cost")),
            other_cost=_number(source.get("other_cost")),
        ))


@router.get("/last-formal-prices")
def last_formal_prices(
    pairs: str = "", current_user: User = Depends(require_erp_role()),
):
    """Bulk, read-only lookup for the comparison screen: latest formal
    (received supplier quotation) price per (item, supplier) pair, one
    query for the whole screen instead of one per row.

    `pairs` is a comma-separated list of "item_id:supplier_id" or
    "item_id:supplier_id:current_quotation_id" tokens (all plain uuid4
    strings, so ":" / "," are safe delimiters). The optional third segment
    names the quotation the comparison screen is currently showing for that
    supplier - when a received quotation seeded the very row being compared,
    it must never be returned as its own "previous" price, so any quotation
    id supplied this way is excluded from the lookup entirely.
    """
    parsed_pairs = set()
    exclude_quotation_ids = set()
    for token in pairs.split(",")[:500]:
        item_id, supplier_id, current_quotation_id = (token.split(":", 2) + ["", ""])[:3]
        if item_id and supplier_id:
            parsed_pairs.add((item_id, supplier_id))
            if current_quotation_id:
                exclude_quotation_ids.add(current_quotation_id)
    with SessionLocal() as session:
        formal_prices = latest_formal_price_by_item_supplier(
            session, parsed_pairs, exclude_quotation_ids or None,
        )
    return {
        "prices": {
            f"{item_id}|{supplier_id}": {
                "unit_price": row["unit_price"],
                "date": row["date"],
                "quotation_id": row["quotation_id"],
            }
            for (item_id, supplier_id), row in formal_prices.items()
        }
    }


@router.get("")
def list_comparisons(current_user: User = Depends(require_erp_role())):
    with SessionLocal() as session:
        comparisons = session.execute(
            select(PriceComparison, func.count(PriceComparisonRow.id))
            .outerjoin(
                PriceComparisonRow,
                PriceComparisonRow.comparison_id == PriceComparison.id,
            )
            .group_by(PriceComparison.id)
            .order_by(PriceComparison.updated_at.desc())
        ).all()
        return [
            {
                "id": comparison.id,
                "comparison_number": comparison.comparison_number,
                "comparison_date": comparison.comparison_date,
                "project_name": comparison.project_name,
                "customer_name": comparison.customer_name,
                "notes": comparison.notes,
                "updated_at": comparison.updated_at,
                "row_count": row_count,
            }
            for comparison, row_count in comparisons
        ]


@router.get("/{comparison_id}")
def get_comparison(comparison_id: str, current_user: User = Depends(require_erp_role())):
    with SessionLocal() as session:
        comparison = session.get(PriceComparison, comparison_id)
        if not comparison:
            raise HTTPException(404, "المقارنة غير موجودة")
        return _detail(session, comparison)


@router.post("")
def create_comparison(
    body: ComparisonIn,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    comparison_number = _next_comparison_number()
    with SessionLocal() as session:
        project, customer, items, suppliers = _references(session, body)
        if not project:
            raise HTTPException(422, "يجب اختيار مشروع صحيح من سجل المشاريع")
        source_request = _source_request(session, body.source_request_id.strip())
        if source_request:
            if source_request.status not in {
                "pricing", "waiting_for_approval", "approved", "converted_to_purchase",
            }:
                raise HTTPException(
                    409,
                    "يجب اعتماد طلب الشراء فنيًا قبل بدء مقارنة الأسعار",
                )
            if not source_request.project_id:
                raise HTTPException(409, "يجب ربط طلب الشراء بمشروع قبل بدء مقارنة الأسعار")
            if source_request.project_id != project.id:
                raise HTTPException(409, "مشروع المقارنة لا يطابق مشروع طلب الشراء المصدر")
        timestamp = _now()
        comparison = PriceComparison(
            id=str(uuid.uuid4()),
            comparison_number=comparison_number,
            project_id=project.id if project else None,
            project_name=project.name if project else body.project_name.strip(),
            customer_id=customer.id if customer else None,
            customer_name=customer.name if customer else body.customer_name.strip(),
            source_request_id=source_request.id if source_request else "",
            source_request_number=source_request.request_number if source_request else "",
            comparison_date=body.comparison_date,
            notes=body.notes,
            created_at=timestamp,
            updated_at=timestamp,
        )
        session.add(comparison)
        _replace_rows(session, comparison, body, items, suppliers)
        _replace_supplier_offers(session, comparison, body, suppliers)
        session.commit()
        return _detail(session, comparison)


@router.delete("/{comparison_id}")
def delete_comparison(
    comparison_id: str,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    """Delete only a draft comparison with no downstream formal document."""
    try:
        from .database import PurchaseOrder
        from .procurement_workflow import EngineerApproval, _audit
    except ImportError:  # pragma: no cover
        from database import PurchaseOrder
        from procurement_workflow import EngineerApproval, _audit

    with SessionLocal() as session:
        comparison = session.get(PriceComparison, comparison_id)
        if not comparison:
            raise HTTPException(404, "المقارنة غير موجودة")
        approval_exists = session.scalar(select(EngineerApproval.id).where(
            EngineerApproval.comparison_id == comparison.id,
        ))
        purchase_order_exists = session.scalar(select(PurchaseOrder.id).where(
            PurchaseOrder.comparison_id == comparison.id,
        ))
        if approval_exists or purchase_order_exists:
            raise HTTPException(
                409,
                "لا يمكن حذف مقارنة أُرسلت للاعتماد أو ارتبطت بأمر شراء. احتفظ بها للتتبع.",
            )
        number = comparison.comparison_number
        project_id = comparison.project_id or ""
        session.execute(delete(PriceComparisonRow).where(
            PriceComparisonRow.comparison_id == comparison.id,
        ))
        session.execute(delete(PriceComparisonSupplierOffer).where(
            PriceComparisonSupplierOffer.comparison_id == comparison.id,
        ))
        session.delete(comparison)
        _audit(
            session, entity_type="price_comparison", entity_id=comparison_id,
            event_type="comparison_deleted", project_id=project_id,
            actor_name=current_user.username,
            message=f"تم حذف مسودة المقارنة {number}",
            metadata={"actor_role": current_user.role, "comparison_number": number},
        )
        session.commit()
        return {"ok": True, "comparison_id": comparison_id, "comparison_number": number}


@router.put("/{comparison_id}")
def update_comparison(
    comparison_id: str, body: ComparisonIn,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    with SessionLocal() as session:
        comparison = session.get(PriceComparison, comparison_id)
        if not comparison:
            raise HTTPException(404, "المقارنة غير موجودة")
        project, customer, items, suppliers = _references(session, body)
        if comparison.project_id and not project:
            raise HTTPException(422, "لا يمكن إزالة مشروع مرتبط من مقارنة أسعار")
        requested_source_id = body.source_request_id.strip()
        if comparison.source_request_id and requested_source_id != comparison.source_request_id:
            raise HTTPException(409, "لا يمكن تغيير طلب الشراء المصدر لمقارنة مرتبطة")
        source_request = _source_request(session, requested_source_id)
        if project and source_request:
            if not source_request.project_id:
                raise HTTPException(409, "يجب ربط طلب الشراء بمشروع قبل ربطه بالمقارنة")
            if source_request.project_id != project.id:
                raise HTTPException(409, "مشروع المقارنة لا يطابق مشروع طلب الشراء المصدر")
        comparison.project_id = project.id if project else None
        comparison.project_name = project.name if project else body.project_name.strip()
        comparison.customer_id = customer.id if customer else None
        comparison.customer_name = (
            customer.name if customer else body.customer_name.strip()
        )
        comparison.source_request_id = source_request.id if source_request else ""
        comparison.source_request_number = (
            source_request.request_number
            if source_request
            else comparison.source_request_number
        )
        comparison.comparison_date = body.comparison_date
        comparison.notes = body.notes
        comparison.updated_at = _now()
        _replace_rows(session, comparison, body, items, suppliers)
        _replace_supplier_offers(session, comparison, body, suppliers)
        session.commit()
        return _detail(session, comparison)


def _style_sheet(sheet) -> None:
    sheet.sheet_view.rightToLeft = True
    sheet.freeze_panes = "A2"
    for cell in sheet[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="1E3A5F")
    for column in sheet.columns:
        width = min(max(len(str(cell.value or "")) for cell in column) + 2, 40)
        sheet.column_dimensions[column[0].column_letter].width = max(width, 12)


def _export_workbook(detail: dict) -> bytes:
    workbook = Workbook()
    lines = workbook.active
    lines.title = "مقارنة المنتجات"
    line_headers = [
        "المنتج",
        "العلامة",
        "التصنيف الرئيسي",
        "التصنيف الفرعي",
        "المواصفات",
        "المورد",
        "الكمية",
        "الوحدة",
        "سعر الوحدة",
        "إجمالي البند",
        "التسليم بالأيام",
        "التوفر",
        "فرق الأقل",
        "فرق الأقل %",
        "آخر سعر تاريخي",
        "فرق السعر التاريخي",
        "نسبة فرق السعر التاريخي",
        "شروط الدفع",
        "صالح حتى",
        "ملاحظات",
    ]
    lines.append(line_headers)
    for row in detail["rows"]:
        lines.append(
            [
                row["product_name"],
                row["brand"],
                row["main_category"],
                row["subcategory"],
                row["specifications"],
                row["supplier_name"],
                row["quantity"],
                row["unit"],
                row["unit_price"],
                row["final_total"],
                row["delivery_days"],
                row["availability"],
                row["difference_from_lowest"],
                row["difference_pct_from_lowest"],
                row["last_historical_unit_price"],
                row["difference_from_last_price"],
                row["difference_pct_from_last_price"],
                row["payment_terms"],
                row["price_valid_until"],
                row["notes"],
            ]
        )
    _style_sheet(lines)

    suppliers = workbook.create_sheet("ملخص الموردين")
    supplier_headers = [
        "المورد",
        "المنتجات",
        "المنتجات المتاحة",
        "غير متاح",
        "إجمالي البنود",
        "الخصم %",
        "الخصومات",
        "الضريبة %",
        "الضرائب",
        "الشحن",
        "تكاليف أخرى",
        "إجمالي العرض",
        "أقصى تسليم",
        "نسبة التوفر",
        "عرض كامل",
        "الفرق عن الأرخص",
        "الفرق %",
    ]
    suppliers.append(supplier_headers)
    for row in detail["supplier_summaries"]:
        suppliers.append(
            [
                row["supplier_name"],
                row["products_quoted"],
                row["available_products"],
                row["unavailable_products"],
                row["items_subtotal"],
                row["discount_pct"],
                row["total_discounts"],
                row["tax_pct"],
                row["total_taxes"],
                row["total_shipping"],
                row["total_other_costs"],
                row["final_offer_total"],
                row["maximum_delivery_days"],
                row["availability_pct"],
                row["is_complete"],
                row["difference_from_lowest_complete"],
                row["difference_pct_from_lowest_complete"],
            ]
        )
    _style_sheet(suppliers)

    summary = workbook.create_sheet("الملخص")
    scenario = detail["scenario_summary"]
    summary.append(["رقم المقارنة", detail["comparison_number"]])
    summary.append(["التاريخ", detail["comparison_date"]])
    summary.append(["المشروع", detail["project_name"]])
    summary.append(["العميل", detail["customer_name"]])
    summary.append(
        [
            "أرخص عرض كامل",
            (scenario["cheapest_complete_supplier"] or {}).get("supplier_name", ""),
        ]
    )
    summary.append(["إجمالي الشراء من مورد واحد", scenario["single_supplier_total"]])
    summary.append(["إجمالي الشراء المختلط", scenario["mixed_supplier_total"]])
    summary.append(["عدد الموردين في الشراء المختلط", scenario["mixed_supplier_count"]])
    summary.append(["التوفير", scenario["savings_amount"]])
    summary.append(["نسبة التوفير", scenario["savings_pct"]])
    summary.sheet_view.rightToLeft = True
    summary.column_dimensions["A"].width = 32
    summary.column_dimensions["B"].width = 28

    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


@router.get("/{comparison_id}/export.xlsx")
def export_comparison(comparison_id: str, current_user: User = Depends(require_erp_role())):
    with SessionLocal() as session:
        comparison = session.get(PriceComparison, comparison_id)
        if not comparison:
            raise HTTPException(404, "المقارنة غير موجودة")
        detail = _detail(session, comparison)
    filename = f"supplier-price-comparison-{detail['comparison_number']}.xlsx"
    return Response(
        content=_export_workbook(detail),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
