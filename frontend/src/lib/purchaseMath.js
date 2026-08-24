export const roundMoney = (value) => (
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
);

export const calculatePurchaseLine = (row) => {
  const quantity = Number(row.quantity) || 0;
  const unitPrice = Number(row.unit_price) || 0;
  const discountPct = Number(row.discount_pct) || 0;
  const vatPct = Number(row.vat_pct) || 0;
  const subtotal = roundMoney(quantity * unitPrice);
  const discount = roundMoney(subtotal * discountPct / 100);
  const afterDiscount = roundMoney(subtotal - discount);
  const vat = roundMoney(afterDiscount * vatPct / 100);
  return {
    subtotal,
    discount,
    afterDiscount,
    vat,
    total: roundMoney(afterDiscount + vat),
  };
};

export const calculatePurchaseTotals = (rows, shippingCost = 0, otherCosts = 0) => {
  const lines = rows.map(calculatePurchaseLine);
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.subtotal, 0));
  const discount = roundMoney(lines.reduce((sum, line) => sum + line.discount, 0));
  const afterDiscount = roundMoney(lines.reduce((sum, line) => sum + line.afterDiscount, 0));
  const vat = roundMoney(lines.reduce((sum, line) => sum + line.vat, 0));
  const shipping = roundMoney(shippingCost);
  const other = roundMoney(otherCosts);
  return {
    subtotal,
    discount,
    afterDiscount,
    vat,
    shipping,
    other,
    final: roundMoney(
      lines.reduce((sum, line) => sum + line.total, 0) + shipping + other,
    ),
  };
};
