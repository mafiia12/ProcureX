import { calculateComparison, calculateLine } from "@/lib/priceComparison";


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

test("calculates discount, tax, shipping, other costs and expiry exactly", () => {
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
  expect(result.discount_amount).toBe(100);
  expect(result.amount_after_discount).toBe(900);
  expect(result.tax_amount).toBe(126);
  expect(result.final_total).toBe(1086);
  expect(result.eligible).toBe(true);

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
    "supplier-1",
    1000,
  ],
  [
    "discounts",
    { unit_price: 120, discount_pct: 25 },
    { unit_price: 100 },
    "supplier-1",
    90,
  ],
  [
    "shipping costs",
    { unit_price: 90, shipping_cost: 30 },
    { unit_price: 100 },
    "supplier-2",
    100,
  ],
  [
    "taxes",
    { unit_price: 90, tax_pct: 20 },
    { unit_price: 100 },
    "supplier-2",
    100,
  ],
])("recommends the lowest numeric final total with %s", (
  _caseName, first, second, expectedSupplier, expectedTotal,
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

  expect(product.lowest_final_total).toBe(expectedTotal);
  expect(product.lowest_final_total_supplier).toBe(
    suppliers.find((supplier) => supplier.id === expectedSupplier).name,
  );
  expect(scenario.cheapest_complete_supplier.supplier_id).toBe(expectedSupplier);
  expect(scenario.cheapest_complete_supplier.final_offer_total).toBe(supplierMinimum);
  expect(scenario.single_supplier_total).toBe(expectedTotal);
  expect(scenario.mixed_supplier_total).toBe(expectedTotal);
  expect(scenario.mixed_supplier_selections[0].supplier_id).toBe(expectedSupplier);
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

test("uses final line total for offer deltas and exposes historical percentages", () => {
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
  expect(first.final_total).toBe(1086);
  expect(second.final_total).toBe(1083);
  expect(first.difference_from_lowest).toBe(3);
  expect(first.difference_pct_from_lowest).toBe(0.28);
  expect(second.difference_pct_from_last_price).toBe(-5);
  expect(result.product_summaries[0]).toMatchObject({
    last_historical_unit_price: 100,
    difference_from_last_price: -5,
    difference_pct_from_last_price: -5,
    available_offer_count: 2,
  });
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
