export const emptyComparisonRow = () => ({
  key: globalThis.crypto?.randomUUID?.() || `row-${Date.now()}-${Math.random()}`,
  item_id: "",
  item_code: "",
  product_name: "",
  brand: "",
  main_category: "",
  subcategory: "",
  specifications: "",
  supplier_id: "",
  supplier_code: "",
  supplier_name: "",
  quantity: "1",
  unit: "",
  unit_price: "",
  discount_pct: "",
  tax_pct: "",
  shipping_cost: "",
  other_cost: "",
  delivery_days: "",
  payment_terms: "",
  availability: "available",
  price_valid_until: "",
  notes: "",
});

export const manualEntryKey = (prefix, ...parts) => (
  `manual-${prefix}-${parts.map((part) => String(part || "").trim().toLocaleLowerCase("ar")).join("|")}`
);

const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
const number = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "")
    .trim()
    .replace(/[٠-٩]/g, (digit) => arabicDigits.indexOf(digit))
    .replace(/٬/g, "")
    .replace(/,/g, "")
    .replace(/٫/g, ".")
    .replace(/\s/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round = (value) => Math.round((number(value) + Number.EPSILON) * 100) / 100;
const ascendingNumber = (field) => (left, right) => (
  number(left[field]) - number(right[field])
);
const lowestBy = (rows, field) => (
  [...rows].sort(ascendingNumber(field))[0] || null
);

export const isOfferComplete = (row) => {
  const hasSupplier = Boolean(
    row.supplier_id || row.supplier_code || row.manual_supplier_key
    || String(row.supplier_name || "").trim(),
  );
  const hasValidAvailability = ["available", "unavailable"].includes(
    row.availability,
  );
  return hasSupplier
    && number(row.quantity) > 0
    && number(row.unit_price) > 0
    && hasValidAvailability;
};

export function calculateLine(row, comparisonDate) {
  const subtotal = number(row.quantity) * number(row.unit_price);
  const discountAmount = subtotal * number(row.discount_pct) / 100;
  const taxableAmount = subtotal - discountAmount;
  const taxAmount = taxableAmount * number(row.tax_pct) / 100;
  const finalTotal = taxableAmount + taxAmount
    + number(row.shipping_cost) + number(row.other_cost);
  const isExpired = Boolean(
    row.price_valid_until && row.price_valid_until < comparisonDate,
  );
  const isMissingPrice = number(row.unit_price) <= 0;
  const isUnavailable = row.availability !== "available";
  const isIncomplete = !isOfferComplete(row);
  return {
    ...row,
    subtotal: round(subtotal),
    discount_amount: round(discountAmount),
    amount_after_discount: round(taxableAmount),
    tax_amount: round(taxAmount),
    final_total: round(finalTotal),
    is_expired: isExpired,
    is_missing_price: isMissingPrice,
    is_unavailable: isUnavailable,
    is_incomplete: isIncomplete,
    eligible: !(isIncomplete || isExpired || isUnavailable),
    difference_from_lowest: null,
    difference_pct_from_lowest: null,
    difference_pct_from_last_price: null,
    is_lowest_final_total: false,
    is_fastest_delivery: false,
  };
}

export function calculateComparison(rows, items, suppliers, comparisonDate) {
  const itemMap = Object.fromEntries(items.map((item) => [item.id, item]));
  const supplierMap = Object.fromEntries(suppliers.map((supplier) => [supplier.id, supplier]));
  const calculatedRows = rows.map((source) => {
    const item = itemMap[source.item_id] || {};
    const supplier = supplierMap[source.supplier_id] || {};
    const lastPrice = source.last_historical_unit_price ?? item.last_price ?? null;
    const calculated = calculateLine({
      ...source,
      item_code: item.code || source.item_code || "",
      product_name: item.product_name || item.name || source.product_name || "",
      brand: item.brand || source.brand || "",
      unit: source.unit || item.unit || "",
      supplier_code: supplier.code || source.supplier_code || "",
      supplier_name: supplier.name || source.supplier_name || "",
    }, comparisonDate);
    return {
      ...calculated,
      last_historical_unit_price: lastPrice,
      difference_from_last_price: lastPrice == null
        ? null : round(number(source.unit_price) - number(lastPrice)),
      difference_pct_from_last_price: lastPrice == null
        ? null : (number(lastPrice)
          ? round((number(source.unit_price) - number(lastPrice)) / number(lastPrice) * 100)
          : 0),
    };
  });

  const productGroups = {};
  calculatedRows.forEach((row) => {
    const itemKey = row.item_id || row.item_code || row.manual_product_key;
    if (!itemKey) return;
    (productGroups[itemKey] ||= []).push(row);
  });
  const productSummaries = Object.values(productGroups).map((groupRows) => {
    const eligible = groupRows.filter((row) => row.eligible);
    const lowestUnitOffer = lowestBy(eligible, "unit_price");
    const lowestFinalOffer = lowestBy(eligible, "final_total");
    const fastestOffer = lowestBy(eligible, "delivery_days");
    const lowestUnit = lowestUnitOffer ? number(lowestUnitOffer.unit_price) : null;
    const lowestFinal = lowestFinalOffer ? number(lowestFinalOffer.final_total) : null;
    const fastest = fastestOffer ? number(fastestOffer.delivery_days) : null;
    groupRows.forEach((row) => {
      if (row.eligible && lowestFinal != null) {
        const difference = number(row.final_total) - lowestFinal;
        row.difference_from_lowest = round(difference);
        row.difference_pct_from_lowest = lowestFinal
          ? round(difference / lowestFinal * 100) : 0;
      }
      row.is_lowest_final_total = Boolean(
        row.eligible && lowestFinal != null
        && Math.abs(number(row.final_total) - lowestFinal) < 0.005,
      );
      row.is_fastest_delivery = Boolean(
        row.eligible && fastest != null && number(row.delivery_days) === fastest,
      );
    });
    const first = groupRows[0];
    const historicalPrice = groupRows.find(
      (row) => row.last_historical_unit_price != null,
    )?.last_historical_unit_price ?? null;
    const historicalDifference = lowestUnit != null && historicalPrice != null
      ? round(lowestUnit - number(historicalPrice)) : null;
    return {
      item_id: first.item_id,
      item_code: first.item_code,
      product_name: first.product_name,
      brand: first.brand,
      lowest_unit_price: lowestUnit,
      lowest_final_total: lowestFinal,
      fastest_delivery_days: fastest,
      lowest_unit_price_supplier: lowestUnitOffer?.supplier_name || null,
      lowest_final_total_supplier: lowestFinalOffer?.supplier_name || null,
      fastest_delivery_supplier: fastestOffer?.supplier_name || null,
      last_historical_unit_price: historicalPrice,
      difference_from_last_price: historicalDifference,
      difference_pct_from_last_price: historicalDifference != null && number(historicalPrice)
        ? round(historicalDifference / number(historicalPrice) * 100) : null,
      available_offer_count: eligible.length,
    };
  });

  const allProducts = new Set(Object.keys(productGroups));
  const rowItemKey = (row) => row.item_id || row.item_code || row.manual_product_key;
  const supplierGroups = {};
  calculatedRows.filter((row) => !row.is_incomplete).forEach((row) => {
    const supplierKey = row.supplier_id || row.supplier_code || row.manual_supplier_key;
    if (!supplierKey) return;
    (supplierGroups[supplierKey] ||= []).push(row);
  });
  const supplierSummaries = Object.values(supplierGroups).map((groupRows) => {
    const eligible = groupRows.filter((row) => row.eligible);
    const availableProducts = new Set(groupRows.filter((row) => (
      row.eligible
    )).map(rowItemKey));
    const eligibleProducts = new Set(eligible.map(rowItemKey));
    const first = groupRows[0];
    return {
      supplier_id: first.supplier_id,
      supplier_code: first.supplier_code,
      supplier_name: first.supplier_name,
      products_quoted: new Set(groupRows.map(rowItemKey)).size,
      unavailable_products: groupRows.filter((row) => row.is_unavailable).length,
      available_products: availableProducts.size,
      items_subtotal: round(eligible.reduce(
        (sum, row) => sum + number(row.subtotal), 0,
      )),
      total_discounts: round(eligible.reduce(
        (sum, row) => sum + number(row.discount_amount), 0,
      )),
      total_taxes: round(eligible.reduce(
        (sum, row) => sum + number(row.tax_amount), 0,
      )),
      total_shipping: round(eligible.reduce(
        (sum, row) => sum + number(row.shipping_cost), 0,
      )),
      total_other_costs: round(eligible.reduce(
        (sum, row) => sum + number(row.other_cost), 0,
      )),
      final_offer_total: round(eligible.reduce(
        (sum, row) => sum + number(row.final_total), 0,
      )),
      maximum_delivery_days: eligible.length
        ? Math.max(...eligible.map((row) => number(row.delivery_days))) : null,
      availability_pct: round(
        allProducts.size ? availableProducts.size / allProducts.size * 100 : 0,
      ),
      is_complete: allProducts.size > 0 && eligibleProducts.size === allProducts.size,
      difference_from_lowest_complete: null,
      difference_pct_from_lowest_complete: null,
    };
  });
  const complete = supplierSummaries.filter((summary) => summary.is_complete);
  const cheapestComplete = lowestBy(complete, "final_offer_total");
  const lowestComplete = cheapestComplete
    ? number(cheapestComplete.final_offer_total) : null;
  complete.forEach((summary) => {
    const difference = number(summary.final_offer_total) - lowestComplete;
    summary.difference_from_lowest_complete = round(difference);
    summary.difference_pct_from_lowest_complete = lowestComplete
      ? round(difference / lowestComplete * 100) : 0;
  });
  const fastestComplete = lowestBy(
    complete.filter((summary) => summary.maximum_delivery_days != null),
    "maximum_delivery_days",
  );
  const highestAvailability = [...supplierSummaries].sort(
    (left, right) => right.availability_pct - left.availability_pct,
  )[0] || null;
  const mixedRows = Object.values(productGroups).flatMap((groupRows) => {
    const eligible = groupRows.filter((row) => row.eligible);
    const lowestOffer = lowestBy(eligible, "final_total");
    return lowestOffer ? [lowestOffer] : [];
  });
  const mixedTotal = round(mixedRows.reduce(
    (sum, row) => sum + number(row.final_total), 0,
  ));
  const singleTotal = cheapestComplete?.final_offer_total ?? null;
  const savings = singleTotal == null ? null : round(singleTotal - mixedTotal);
  const mixedSupplierCount = new Set(mixedRows.map(
    (row) => row.supplier_id || row.supplier_code || row.manual_supplier_key,
  )).size;

  return {
    rows: calculatedRows,
    product_summaries: productSummaries,
    supplier_summaries: supplierSummaries,
    scenario_summary: {
      cheapest_complete_supplier: cheapestComplete,
      fastest_complete_supplier: fastestComplete,
      highest_availability_supplier: highestAvailability,
      single_supplier_total: singleTotal,
      mixed_supplier_total: mixedTotal,
      mixed_supplier_count: mixedSupplierCount,
      mixed_supplier_selections: mixedRows.map((row) => ({
        item_id: row.item_id,
        product_name: row.product_name,
        supplier_id: row.supplier_id,
        supplier_name: row.supplier_name,
        final_total: row.final_total,
      })),
      savings_amount: savings,
      savings_pct: savings != null && singleTotal
        ? round(savings / singleTotal * 100) : null,
    },
  };
}
