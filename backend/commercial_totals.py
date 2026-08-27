"""Authoritative supplier-offer commercial total calculation."""

from __future__ import annotations

from math import isfinite


def number(value) -> float:
    if value is None or value == "":
        return 0.0
    try:
        result = float(value)
    except (TypeError, ValueError):
        return 0.0
    return result if isfinite(result) else 0.0


def money(value) -> float:
    return round(number(value) + 1e-12, 2)


def calculate_supplier_total(
    item_subtotal,
    discount_pct=0,
    tax_pct=0,
    shipping_cost=0,
    other_cost=0,
) -> dict[str, float]:
    """Apply ProcureX's approved order: discount, VAT, then offer costs."""
    subtotal = money(item_subtotal)
    discount = money(subtotal * number(discount_pct) / 100)
    after_discount = money(subtotal - discount)
    vat = money(after_discount * number(tax_pct) / 100)
    shipping = money(shipping_cost)
    other = money(other_cost)
    return {
        "items_subtotal": subtotal,
        "total_discounts": discount,
        "amount_after_discount": after_discount,
        "total_taxes": vat,
        "total_shipping": shipping,
        "total_other_costs": other,
        "final_offer_total": money(after_discount + vat + shipping + other),
    }
