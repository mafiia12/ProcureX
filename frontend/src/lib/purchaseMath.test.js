import { calculatePurchaseLine, calculatePurchaseTotals } from "./purchaseMath";

test("purchase calculations round each stored line and keep invoice totals consistent", () => {
  const rows = [
    { quantity: 3, unit_price: 10.005, discount_pct: 5, vat_pct: 14 },
    { quantity: 2.5, unit_price: 7.777, discount_pct: 0, vat_pct: 14 },
  ];
  const lines = rows.map(calculatePurchaseLine);
  const totals = calculatePurchaseTotals(rows, 0.005, 0);
  expect(lines).toEqual([
    { subtotal: 30.02, discount: 1.5, afterDiscount: 28.52, vat: 3.99, total: 32.51 },
    { subtotal: 19.44, discount: 0, afterDiscount: 19.44, vat: 2.72, total: 22.16 },
  ]);
  expect(totals.final).toBe(54.68);
  expect(totals.final).toBe(
    lines.reduce((sum, line) => sum + line.total, 0) + totals.shipping + totals.other,
  );
});
