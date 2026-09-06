import {
  calculateComparison, calculateLine, calculateSupplierTotal,
  formalPriceChange, formatPriceChangePercent,
} from "@/lib/priceComparison";


const items = [
  { id: "item-1", code: "ITM-1", product_name: "منتج 1", brand: "A", unit: "قطعة" },
  { id: "item-2", code: "ITM-2", product_name: "منتج 2", brand: "B", unit: "متر" },
];
const suppliers = [
  { id: "supplier-1", code: "SUP-1", name: "المورد أ" },
  { id: "supplier-2", code: "SUP-2", name: "المورد ب" },
  { id: "supplier-3", code: "SUP-3", name: "المورد ج" },
];

const row = (itemId, supplierId, unitPrice, deliveryDays, extra = {}) => ({
  key: `${itemId}-${supplierId}`,
  item_id: itemId,
  supplier_id: supplierId,
  quantity: 1,
  unit_price: unitPrice,
  discount_pct: 0,
  tax_pct: 0,
  shipping_cost: 0,
  other_cost: 0,
  delivery_days: deliveryDays,
  availability: "available",
  price_valid_until: "2099-12-31",
  ...extra,
});

test("keeps item totals item-level and applies offer adjustments once", () => {
  const result = calculateLine({
    supplier_name: "مورد اختبار",
    quantity: 10,
    unit_price: 100,
    discount_pct: 10,
    tax_pct: 14,
    shipping_cost: 50,
    other_cost: 10,
    availability: "available",
    price_valid_until: "2099-12-31",
  }, "2026-07-28");
  expect(result.subtotal).toBe(1000);
  expect(result.final_total).toBe(1000);
  expect(result.eligible).toBe(true);
  expect(calculateSupplierTotal(result.subtotal, {
    discount_pct: 10, tax_pct: 14, shipping_cost: 50, other_cost: 10,
  })).toEqual({
    items_subtotal: 1000, total_discounts: 100, amount_after_discount: 900,
    total_taxes: 126, total_shipping: 50, total_other_costs: 10,
    final_offer_total: 1086,
  });

  const expired = calculateLine({
    quantity: 1, unit_price: 50, availability: "available",
    price_valid_until: "2020-01-01",
  }, "2026-07-28");
  expect(expired.is_expired).toBe(true);
  expect(expired.eligible).toBe(false);
});

test.each([
  [
    "formatted numeric prices",
    { unit_price: "١٬٠٠٠" },
    { unit_price: "1,100" },
    "supplier-1", "supplier-1", 1000, 1000, 1000,
  ],
  [
    "discounts",
    { unit_price: 120, discount_pct: 25 },
    { unit_price: 100 },
    "supplier-2", "supplier-1", 100, 90, 100,
  ],
  [
    "shipping costs",
    { unit_price: 90, shipping_cost: 30 },
    { unit_price: 100 },
    "supplier-1", "supplier-2", 90, 100, 120,
  ],
  [
    "taxes",
    { unit_price: 90, tax_pct: 20 },
    { unit_price: 100 },
    "supplier-1", "supplier-2", 90, 100, 108,
  ],
])("recommends the lowest numeric final total with %s", (
  _caseName, first, second, expectedItemSupplier, expectedSupplier,
  expectedItemTotal, expectedTotal, expectedMixedTotal,
) => {
  const result = calculateComparison([
    row("item-1", "supplier-1", 1, 5, first),
    row("item-1", "supplier-2", 1, 5, second),
  ], items, suppliers, "2026-07-28");
  const product = result.product_summaries[0];
  const scenario = result.scenario_summary;
  const supplierMinimum = Math.min(
    ...result.supplier_summaries.map((summary) => summary.final_offer_total),
  );

  expect(product.lowest_final_total).toBe(expectedItemTotal);
  expect(product.lowest_final_total_supplier).toBe(
    suppliers.find((supplier) => supplier.id === expectedItemSupplier).name,
  );
  expect(scenario.cheapest_complete_supplier.supplier_id).toBe(expectedSupplier);
  expect(scenario.cheapest_complete_supplier.final_offer_total).toBe(supplierMinimum);
  expect(scenario.single_supplier_total).toBe(expectedTotal);
  expect(scenario.mixed_supplier_total).toBe(expectedMixedTotal);
  expect(scenario.mixed_supplier_selections[0].supplier_id).toBe(expectedItemSupplier);
});

test("preserves equal-price ties and uses stable first-offer recommendations", () => {
  const result = calculateComparison([
    row("item-1", "supplier-1", 100, 5),
    row("item-1", "supplier-2", 100, 5),
  ], items, suppliers, "2026-07-28");

  expect(result.rows.map((entry) => entry.is_lowest_final_total)).toEqual([true, true]);
  expect(result.product_summaries[0].lowest_final_total_supplier).toBe(suppliers[0].name);
  expect(result.scenario_summary.cheapest_complete_supplier.supplier_id)
    .toBe("supplier-1");
  expect(result.supplier_summaries.map(
    (summary) => summary.difference_from_lowest_complete,
  )).toEqual([0, 0]);
});

test("builds the mixed-supplier scenario from each product's lowest final total", () => {
  const result = calculateComparison([
    row("item-1", "supplier-1", 100, 5),
    row("item-1", "supplier-2", 130, 5),
    row("item-2", "supplier-1", 200, 5),
    row("item-2", "supplier-2", 150, 5),
  ], items, suppliers, "2026-07-28");
  const scenario = result.scenario_summary;

  expect(scenario.cheapest_complete_supplier.supplier_id).toBe("supplier-2");
  expect(scenario.single_supplier_total).toBe(280);
  expect(scenario.mixed_supplier_total).toBe(250);
  expect(scenario.savings_amount).toBe(30);
  expect(scenario.savings_pct).toBe(10.71);
  expect(scenario.mixed_supplier_selections.map((selection) => [
    selection.item_id, selection.supplier_id, selection.final_total,
  ])).toEqual([
    ["item-1", "supplier-1", 100],
    ["item-2", "supplier-2", 150],
  ]);
});

test("compares multiple products and complete supplier offers without auto-selection", () => {
  const rows = [
    row("item-1", "supplier-1", 100, 5),
    row("item-1", "supplier-2", 90, 7),
    row("item-1", "supplier-3", 80, 1, { availability: "unavailable" }),
    row("item-2", "supplier-1", 200, 8),
    row("item-2", "supplier-2", 230, 4),
    row("item-2", "supplier-3", 0, 2),
  ];
  const result = calculateComparison(rows, items, suppliers, "2026-07-28");

  expect(result.product_summaries).toHaveLength(2);
  expect(result.rows.find((entry) => entry.key === "item-1-supplier-2")
    .is_lowest_final_total).toBe(true);
  expect(result.rows.find((entry) => entry.key === "item-1-supplier-3")
    .is_unavailable).toBe(true);
  expect(result.rows.find((entry) => entry.key === "item-2-supplier-3")
    .is_missing_price).toBe(true);
  expect(result.supplier_summaries.find(
    (entry) => entry.supplier_id === "supplier-3",
  ).availability_pct).toBe(0);
  expect(result.supplier_summaries.find(
    (entry) => entry.supplier_id === "supplier-3",
  ).available_products).toBe(0);
  expect(result.supplier_summaries).toHaveLength(3);
  expect(result.scenario_summary.cheapest_complete_supplier.supplier_id)
    .toBe("supplier-1");
  expect(result.scenario_summary.fastest_complete_supplier.supplier_id)
    .toBe("supplier-2");
  expect(result.scenario_summary.single_supplier_total).toBe(300);
  expect(result.scenario_summary.mixed_supplier_total).toBe(290);
  expect(result.scenario_summary.mixed_supplier_count).toBe(2);
  expect(result.scenario_summary.savings_amount).toBe(10);
  expect(result.scenario_summary.savings_pct).toBe(3.33);
});

test("uses raw item total for item deltas and offer total for supplier ranking", () => {
  const result = calculateComparison([
    row("item-1", "supplier-1", 100, 5, {
      quantity: 10, discount_pct: 10, tax_pct: 14, shipping_cost: 50,
      other_cost: 10, last_historical_unit_price: 100,
    }),
    row("item-1", "supplier-2", 95, 3, {
      quantity: 10, tax_pct: 14, last_historical_unit_price: 100,
    }),
  ], items, suppliers, "2026-07-28");
  const first = result.rows.find((entry) => entry.supplier_id === "supplier-1");
  const second = result.rows.find((entry) => entry.supplier_id === "supplier-2");
  expect(first.final_total).toBe(1000);
  expect(second.final_total).toBe(950);
  expect(first.difference_from_lowest).toBe(50);
  expect(first.difference_pct_from_lowest).toBe(5.26);
  expect(second.difference_pct_from_last_price).toBe(-5);
  expect(result.product_summaries[0]).toMatchObject({
    last_historical_unit_price: 100,
    difference_from_last_price: -5,
    difference_pct_from_last_price: -5,
    available_offer_count: 2,
  });
});

test("shipping and other costs are each applied once for a multi-item offer", () => {
  const result = calculateComparison([
    row("item-1", "supplier-1", 100, 5),
    row("item-2", "supplier-1", 200, 5),
  ], items, suppliers, "2026-07-28", [{
    supplier_id: "supplier-1", discount_pct: 10, tax_pct: 14,
    shipping_cost: 50, other_cost: 25,
  }]);
  expect(result.supplier_summaries[0]).toMatchObject({
    items_subtotal: 300,
    total_discounts: 30,
    total_taxes: 37.8,
    total_shipping: 50,
    total_other_costs: 25,
    final_offer_total: 382.8,
  });
});

test("cheapest complete supplier uses final total and excludes an incomplete offer", () => {
  const result = calculateComparison([
    row("item-1", "supplier-1", 80, 5),
    row("item-2", "supplier-1", 80, 5),
    row("item-1", "supplier-2", 90, 5),
    row("item-2", "supplier-2", 90, 5),
    row("item-1", "supplier-3", 10, 5),
  ], items, suppliers, "2026-07-28", [
    { supplier_id: "supplier-1", shipping_cost: 50 },
    { supplier_id: "supplier-2", discount_pct: 20 },
    { supplier_id: "supplier-3" },
  ]);
  expect(result.scenario_summary.cheapest_complete_supplier).toMatchObject({
    supplier_id: "supplier-2", items_subtotal: 180, final_offer_total: 144,
  });
  expect(result.supplier_summaries.find((entry) => entry.supplier_id === "supplier-3").is_complete).toBe(false);
});

test("groups manual products and suppliers without changing line formulas", () => {
  const manualProductKey = "manual-item-product-a";
  const rows = [
    {
      ...row("", "", 100, 5),
      key: "manual-1",
      item_id: "",
      supplier_id: "",
      product_name: "منتج يدوي",
      supplier_name: "مورد يدوي أ",
      manual_product_key: manualProductKey,
      manual_supplier_key: "manual-supplier-a",
    },
    {
      ...row("", "", 90, 3),
      key: "manual-2",
      item_id: "",
      supplier_id: "",
      product_name: "منتج يدوي",
      supplier_name: "مورد يدوي ب",
      manual_product_key: manualProductKey,
      manual_supplier_key: "manual-supplier-b",
    },
  ];
  const result = calculateComparison(rows, [], [], "2026-07-28");
  expect(result.product_summaries).toHaveLength(1);
  expect(result.supplier_summaries).toHaveLength(2);
  expect(result.product_summaries[0].lowest_unit_price).toBe(90);
  expect(result.product_summaries[0].fastest_delivery_days).toBe(3);
});

test("excludes incomplete request offers from rankings and supplier totals", () => {
  const result = calculateComparison([
    {
      ...row("item-1", "", 0, 0),
      key: "request-incomplete",
      supplier_id: "",
      supplier_name: "",
      selected_for_purchase: 1,
    },
    row("item-1", "supplier-1", 125, 4),
  ], items, suppliers, "2026-07-28");

  expect(result.rows[0]).toMatchObject({
    is_incomplete: true,
    eligible: false,
    is_lowest_final_total: false,
  });
  expect(result.product_summaries[0].lowest_unit_price).toBe(125);
  expect(result.supplier_summaries).toHaveLength(1);
  expect(result.scenario_summary.mixed_supplier_total).toBe(125);
});

describe("formalPriceChange", () => {
  test("current 120 / previous 100 -> up +20%", () => {
    const change = formalPriceChange(120, 100);
    expect(change.direction).toBe("up");
    expect(change.percent).toBe(20);
    expect(change.delta).toBe(20);
    expect(formatPriceChangePercent(change.percent)).toBe("+20.0%");
  });

  test("current 80 / previous 100 -> down -20%", () => {
    const change = formalPriceChange(80, 100);
    expect(change.direction).toBe("down");
    expect(change.percent).toBe(-20);
    expect(formatPriceChangePercent(change.percent)).toBe("-20.0%");
  });

  test("current 100 / previous 100 -> unchanged", () => {
    const change = formalPriceChange(100, 100);
    expect(change.direction).toBe("same");
    expect(change.percent).toBe(0);
    expect(formatPriceChangePercent(change.percent)).toBe("0%");
  });

  test("previous null/undefined -> no history to compare (null)", () => {
    expect(formalPriceChange(120, null)).toBeNull();
    expect(formalPriceChange(120, undefined)).toBeNull();
  });

  test("previous 0 -> never divides by zero, percent is null but direction still resolves", () => {
    const change = formalPriceChange(120, 0);
    expect(change.percent).toBeNull();
    expect(change.direction).toBe("up");
    expect(formatPriceChangePercent(change.percent)).toBeNull();

    const unchangedAtZero = formalPriceChange(0, 0);
    expect(unchangedAtZero.direction).toBe("same");
    expect(unchangedAtZero.percent).toBeNull();
  });

  test("rounds cleanly to one decimal instead of raw floating point", () => {
    const change = formalPriceChange(110, 88);
    // (110-88)/88*100 = 25.0000000000000036 unrounded.
    expect(change.percent).toBe(25);
    expect(formatPriceChangePercent(change.percent)).toBe("+25.0%");

    const messyChange = formalPriceChange(100, 33);
    // (100-33)/33*100 = 203.03030303...
    expect(formatPriceChangePercent(messyChange.percent)).toMatch(/^\+\d+\.\d%$/);
  });

  test("malformed/non-numeric current or previous price never throws", () => {
    expect(() => formalPriceChange("abc", 100)).not.toThrow();
    expect(() => formalPriceChange(100, "abc")).not.toThrow();
    expect(formalPriceChange("abc", 100).current).toBe(0);
  });
});
