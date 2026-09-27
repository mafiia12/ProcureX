import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";

import SupplierPriceComparison from "@/pages/SupplierPriceComparison";

jest.mock("react-router-dom", () => ({
  useLocation: () => ({ state: globalThis.mockComparisonLocationState || null }),
  useNavigate: () => jest.fn(),
}), { virtual: true });


globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const items = [
  { id: "item-1", code: "ITM-1", product_name: "منتج اختبار", brand: "A", main_category: "رئيسي", subcategory: "فرعي", specifications: "مواصفة", unit: "قطعة", last_price: 80, last_supplier: "مورد سابق", last_date: "2026-07-15" },
];
const suppliers = [
  { id: "supplier-1", code: "SUP-1", name: "المورد الأخضر" },
  { id: "supplier-2", code: "SUP-2", name: "المورد غير المتاح" },
];
const detail = {
  id: "comparison-1",
  comparison_number: "CMP-000001",
  comparison_date: "2026-07-28",
  project_name: "مشروع",
  customer_name: "عميل",
  notes: "",
  rows: [
    {
      id: "row-1", item_id: "item-1", supplier_id: "supplier-1", quantity: 2,
      item_code: "ITM-1", product_name: "منتج اختبار", brand: "A",
      main_category: "رئيسي", subcategory: "فرعي", specifications: "مواصفة",
      supplier_code: "SUP-1", supplier_name: "المورد الأخضر",
      unit: "قطعة", unit_price: 100, discount_pct: 0, tax_pct: 0,
      shipping_cost: 0, other_cost: 0, delivery_days: 5, payment_terms: "نقدي",
      availability: "available", price_valid_until: "2099-12-31", notes: "",
    },
    {
      id: "row-2", item_id: "item-1", supplier_id: "supplier-2", quantity: 2,
      item_code: "ITM-1", product_name: "منتج اختبار", brand: "A",
      main_category: "رئيسي", subcategory: "فرعي", specifications: "مواصفة",
      supplier_code: "SUP-2", supplier_name: "المورد غير المتاح",
      unit: "قطعة", unit_price: 90, discount_pct: 0, tax_pct: 0,
      shipping_cost: 0, other_cost: 0, delivery_days: 2, payment_terms: "",
      availability: "unavailable", price_valid_until: "2099-12-31", notes: "",
    },
  ],
};

const getResponse = (url) => {
  if (url === "/items") return Promise.resolve({ data: items });
  if (url === "/suppliers") return Promise.resolve({ data: suppliers });
  if (url === "/projects" || url === "/customers") return Promise.resolve({ data: [] });
  if (url === "/price-comparisons") return Promise.resolve({
    data: [{ id: detail.id, comparison_number: detail.comparison_number, row_count: 2 }],
  });
  if (url === `/price-comparisons/${detail.id}`) return Promise.resolve({ data: detail });
  return Promise.resolve({ data: [] });
};
const mockGet = jest.fn(getResponse);
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();

jest.mock("@/lib/api", () => ({
  __esModule: true,
  fmt: (value) => Number(value || 0).toFixed(2),
  errMsg: () => "خطأ",
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
    put: (...args) => mockPut(...args),
    delete: (...args) => mockDelete(...args),
  },
}));

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock("@/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    language: globalThis.mockComparisonLanguage || "ar",
    direction: globalThis.mockComparisonLanguage === "en" ? "ltr" : "rtl",
  }),
}));
jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }) => (open ? <>{children}</> : null),
  DialogContent: ({ children, ...props }) => <div {...props}>{children}</div>,
  DialogDescription: ({ children }) => <p>{children}</p>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
}));

const setNativeValue = (element, value) => {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(() => {
  globalThis.mockComparisonLanguage = "ar";
  globalThis.mockComparisonLocationState = null;
  window.print = jest.fn();
  mockGet.mockImplementation(getResponse);
  mockPost.mockReset();
  mockPut.mockReset();
  mockDelete.mockReset();
  mockPost.mockImplementation((url, body) => {
    if (url === "/suppliers") return Promise.resolve({
      data: { id: "saved-supplier", code: "SUP-9999", name: body.name },
    });
    if (url === "/items") return Promise.resolve({
      data: { id: "saved-item", code: "MAT-9999", ...body },
    });
    return Promise.resolve({ data: detail });
  });
  mockPut.mockResolvedValue({ data: detail });
});

test("adds each eligible request item once into one aligned supplier column", async () => {
  globalThis.mockComparisonLocationState = {
    sourceRequest: {
      request_id: "request-1",
      request_number: "REQ-000001",
      project_name: "مشروع طلب",
      requester_name: "مقدم الطلب",
      items: [{
        id: "request-item-1",
        position: 1,
        product_name: "منتج طلب يدوي",
        preferred_brand: "علامة مفضلة",
        main_category: "تصنيف طلب",
        subcategory: "فرعي طلب",
        specifications: "مواصفات طلب",
        quantity: 3,
        unit: "قطعة",
        review_status: "approved",
      }],
    },
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SupplierPriceComparison />);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  await act(async () => {
    container.querySelector('[data-testid="add-request-item-request-item-1"]').click();
    container.querySelector('[data-testid="add-request-item-request-item-1"]').click();
  });
  expect(container.querySelectorAll('[data-testid="comparison-row"]')).toHaveLength(1);
  expect(container.querySelectorAll('[data-testid="supplier-offer-card"]')).toHaveLength(1);
  expect(container.querySelector('[data-testid="supplier-column-selector"]')).not.toBeNull();
  expect(container.textContent).toContain("عرض غير مكتمل");

  await act(async () => container.querySelector('[data-testid="add-all-request-items"]').click());
  expect(container.querySelectorAll('[data-testid="comparison-row"]')).toHaveLength(1);

  await act(async () => root.unmount());
  container.remove();
});

test("renders operational comparison controls in English", async () => {
  globalThis.mockComparisonLanguage = "en";
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SupplierPriceComparison />);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  for (const label of [
    "Supplier price comparison", "Comparison settings", "Price matrix",
    "Add supplier", "Save", "Filters", "All availability",
  ]) expect(container.textContent).toContain(label);
  expect(container.querySelector('[data-testid="comparison-print"]').title).toBe("Print");
  expect(container.textContent).not.toContain("Add supplier offer");
  expect(container.textContent).not.toContain("بيانات المقارنة");

  await act(async () => root.unmount());
  container.remove();
});

test("an empty comparison hides the summary bar, mixed-selection panel, and detailed analysis section", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SupplierPriceComparison />);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  expect(container.querySelector('[data-testid="comparison-summary-bar"]')).toBeNull();
  expect(container.querySelector('[data-testid="mixed-selection-summary"]')).toBeNull();
  expect(container.textContent).not.toContain("Product comparison");
  expect(container.textContent).not.toContain("Supplier summary");
  expect(container.textContent).not.toContain("Mixed purchase and savings summary");
  // Advanced (secondary) filters stay collapsed by default but remain present in the DOM.
  expect(container.querySelector('[data-testid="advanced-filters"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="advanced-filters"]').hasAttribute("open")).toBe(false);

  await act(async () => root.unmount());
  container.remove();
});

test("compact summary bar shows item and supplier counts once the comparison has rows, and hides the mixed-selection panel without a multi-supplier selection", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SupplierPriceComparison initialComparison={detail} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  const bar = container.querySelector('[data-testid="comparison-summary-bar"]');
  expect(bar).not.toBeNull();
  expect(bar.textContent).toContain("1"); // one distinct item
  expect(bar.textContent).toContain("2"); // two suppliers quoted
  expect(container.querySelector('[data-testid="mixed-selection-summary"]')).toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("bottom decision summary identifies a mixed supplier selection", async () => {
  const mixedDetail = {
    ...detail,
    rows: [
      { ...detail.rows[0], id: "row-m1", item_id: "item-1", item_code: "ITM-1", product_name: "منتج أول", selected_for_purchase: 1 },
      {
        ...detail.rows[0], id: "row-m2", item_id: "item-2", item_code: "ITM-2", product_name: "منتج ثان",
        supplier_id: "supplier-2", supplier_code: "SUP-2", supplier_name: "المورد غير المتاح",
        unit_price: 60, selected_for_purchase: 1,
      },
    ],
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SupplierPriceComparison initialComparison={mixedDetail} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  const mixed = [...container.querySelectorAll('[data-testid="comparison-summary-bar"] span')]
    .find((element) => element.textContent.includes("اختيار مختلط"));
  expect(mixed).toBeTruthy();
  expect(mixed.textContent).toContain("2 موردين");
  expect(mixed.title).toContain("المورد الأخضر");
  expect(mixed.title).toContain("المورد غير المتاح");

  await act(async () => root.unmount());
  container.remove();
});

test("reopens a multi-supplier comparison and renders core columns and highlights", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SupplierPriceComparison initialComparison={detail} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  expect(container.querySelector('[data-testid="supplier-price-comparison-page"]'))
    .not.toBeNull();
  const text = container.textContent;
  for (const heading of ["المنتج", "المورد", "الكمية", "سعر الوحدة", "الإجمالي", "مدة التوريد"]) {
    expect(text).toContain(heading);
  }
  expect(text).toContain("CMP-000001");
  const renderedRows = [...container.querySelectorAll('[data-testid="comparison-row"]')];
  expect(renderedRows).toHaveLength(2);
  expect(renderedRows.some((row) => row.className.includes("bg-emerald-500/5"))).toBe(true);
  expect(renderedRows.some((row) => row.className.includes("bg-destructive/5"))).toBe(true);
  expect(container.textContent).toContain("المورد الأخضر");
  expect(container.textContent).toContain("المورد غير المتاح");
  const commandBar = container.querySelector('[data-testid="comparison-command-bar"]');
  expect(commandBar).not.toBeNull();
  expect(commandBar.classList.contains("py-1")).toBe(true);
  expect(container.querySelector('[data-testid="comparison-save"]').classList.contains("h-7")).toBe(true);
  expect(container.querySelector('[data-testid="compact-workflow"]').textContent).toContain("المرحلة: المقارنة");
  expect(container.textContent).toContain("مصفوفة الأسعار");
  for (const section of ["3 — مقارنة المنتجات", "4 — ملخص الموردين", "5 — ملخص الشراء المختلط والتوفير"]) expect(container.textContent).toContain(section);
  expect(container.querySelectorAll('[data-testid="supplier-offer-card"]')).toHaveLength(2);
  const mobileList = container.querySelector('[data-testid="mobile-comparison-list"]');
  expect(mobileList).not.toBeNull();
  expect(mobileList.classList.contains("sm:hidden")).toBe(true);
  expect(mobileList.querySelectorAll('[data-testid="mobile-comparison-row"]')).toHaveLength(2);
  expect(mobileList.querySelector('[data-testid^="mobile-inline-unit-price-"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="select-cheapest-complete-offer"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="offers-category-filter"] option[value="رئيسي"]')).not.toBeNull();
  await act(async () => container.querySelector('[data-testid="comparison-print"]').click());
  expect(window.print).toHaveBeenCalledTimes(1);

  await act(async () => root.unmount());
  container.remove();
});

test("collapsed filters drive the aligned matrix without changing supplier totals", async () => {
  const filteredDetail = {
    ...detail,
    rows: [
      { ...detail.rows[0], id: "filter-a1", item_id: "item-1", product_name: "منتج أول", main_category: "تصنيف أ" },
      { ...detail.rows[1], id: "filter-a2", item_id: "item-1", product_name: "منتج أول", main_category: "تصنيف أ", availability: "available" },
      { ...detail.rows[0], id: "filter-b1", item_id: "item-2", item_code: "ITM-2", product_name: "منتج ثان", main_category: "تصنيف ب" },
      { ...detail.rows[1], id: "filter-b2", item_id: "item-2", item_code: "ITM-2", product_name: "منتج ثان", main_category: "تصنيف ب", availability: "available" },
    ],
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SupplierPriceComparison initialComparison={filteredDetail} />);
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

  const filters = container.querySelector('[data-testid="advanced-filters"]');
  expect(filters.hasAttribute("open")).toBe(false);
  const category = container.querySelector('[data-testid="offers-category-filter"]');
  await act(async () => {
    category.value = "تصنيف أ";
    category.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const matrix = container.querySelector('[data-testid="comparison-matrix"]');
  expect(matrix.textContent).toContain("منتج اختبار");
  expect(matrix.textContent).not.toContain("منتج ثان");
  expect(matrix.querySelectorAll('[data-testid="comparison-row"]')).toHaveLength(2);
  expect(matrix.querySelectorAll('[data-testid="supplier-offer-summary"]')).toHaveLength(2);

  await act(async () => root.unmount());
  container.remove();
});

test("add-all includes only approved request items and hides the redundant offer/PO actions", async () => {
  globalThis.mockComparisonLocationState = {
    sourceRequest: {
      request_id: "request-mixed", request_number: "REQ-MIXED", project_name: "مشروع",
      items: [
        { id: "approved", position: 1, product_name: "معتمد", quantity: 2, unit: "قطعة", review_status: "approved" },
        { id: "rejected", position: 2, product_name: "مرفوض", quantity: 1, unit: "قطعة", review_status: "rejected" },
      ],
    },
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SupplierPriceComparison />);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await act(async () => container.querySelector('[data-testid="add-all-request-items"]').click());
  expect(container.querySelectorAll('[data-testid="comparison-row"]')).toHaveLength(1);
  expect(container.textContent).toContain("مستبعد");
  expect(container.querySelector('[data-testid="add-request-item-rejected"]').disabled).toBe(true);
  expect(container.querySelector('[data-testid="add-offer-section"]')).toBeNull();
  expect(container.textContent).not.toContain("تجهيز أوامر الشراء");
  await act(async () => root.unmount());
  container.remove();
});

test("deletes a safe saved comparison through the authenticated API after confirmation", async () => {
  window.confirm = jest.fn(() => true);
  mockDelete.mockResolvedValue({ data: { ok: true, comparison_number: "CMP-000001" } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SupplierPriceComparison initialComparison={detail} />);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await act(async () => {
    container.querySelector('[data-testid="comparison-more-actions"]').click();
  });
  await act(async () => {
    container.querySelector('[data-testid="delete-comparison"]').click();
    await Promise.resolve();
  });
  expect(mockDelete).toHaveBeenCalledWith("/price-comparisons/comparison-1");
  await act(async () => root.unmount());
  container.remove();
});

test("cheapest complete action selects every eligible row and excludes an incomplete supplier", async () => {
  const twoItemDetail = {
    ...detail,
    rows: [
      { ...detail.rows[0], id: "row-a1", item_id: "item-1", item_code: "ITM-1", product_name: "منتج أول", unit_price: 100 },
      { ...detail.rows[0], id: "row-a2", item_id: "item-2", item_code: "ITM-2", product_name: "منتج ثان", unit_price: 120 },
      { ...detail.rows[1], id: "row-b1", item_id: "item-1", item_code: "ITM-1", product_name: "منتج أول", availability: "available", unit_price: 80 },
    ],
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<SupplierPriceComparison initialComparison={twoItemDetail} />); await new Promise((resolve) => setTimeout(resolve, 30)); });

  const matrix = container.querySelector('[data-testid="comparison-matrix"]');
  expect(matrix.classList.contains("min-h-0")).toBe(true);
  expect(matrix.classList.contains("flex-1")).toBe(true);
  expect(container.querySelector('[data-testid="comparison-workspace"]').classList.contains("h-[calc(100dvh-69px)]")).toBe(true);
  expect(matrix.querySelectorAll('[data-testid="complete-offer-badge"]')).toHaveLength(1);
  expect(matrix.querySelectorAll('[data-testid="incomplete-offer-badge"]')).toHaveLength(1);
  expect(matrix.querySelectorAll('[data-testid="lowest-offer-badge"]')).toHaveLength(1);
  expect(matrix.querySelectorAll('[data-testid="not-offered-badge"]')).toHaveLength(1);
  expect(matrix.querySelectorAll('[data-testid="supplier-offer-summary"]')).toHaveLength(2);
  const priceInput = matrix.querySelector('[data-testid^="inline-unit-price-"]');
  expect(priceInput.classList.contains("h-7")).toBe(true);
  expect(priceInput.classList.contains("tabular-nums")).toBe(true);
  const itemCell = [...matrix.children[0].children]
    .find((element) => element.style.gridColumn === "1" && element.style.gridRow === "2");
  expect(itemCell.classList.contains("sticky")).toBe(true);
  expect(itemCell.classList.contains("py-1")).toBe(true);
  const alternateItemCell = [...matrix.children[0].children]
    .find((element) => element.style.gridColumn === "1" && element.style.gridRow === "3");
  expect(alternateItemCell.classList.contains("bg-muted/15")).toBe(true);
  const supplierHeader = [...matrix.querySelectorAll("div")]
    .find((element) => element.style.gridColumn === "2" && element.style.gridRow === "1");
  expect(supplierHeader.classList.contains("sticky")).toBe(true);
  expect(supplierHeader.classList.contains("top-0")).toBe(true);
  expect(container.querySelector('[data-testid="supplier-pager"]').textContent).toContain("1–2 من 2");
  const decisionBar = container.querySelector('[data-testid="comparison-summary-bar"]');
  expect(decisionBar.classList.contains("sticky")).toBe(false);
  expect(decisionBar.classList.contains("shrink-0")).toBe(true);
  const summaryMetrics = container.querySelector('[data-testid="comparison-summary-metrics"]');
  expect(summaryMetrics.classList.contains("overflow-x-auto")).toBe(true);
  expect(container.querySelector('[data-testid="comparison-summary-send"]').classList.contains("shrink-0")).toBe(true);
  expect(container.querySelector('[data-testid="supplier-price-comparison-page"]').classList.contains("pb-16")).toBe(false);
  expect(matrix.classList.contains("scroll-pb-16")).toBe(false);

  await act(async () => container.querySelector('[data-testid="select-cheapest-complete-offer"]').click());
  const completeCard = [...container.querySelectorAll('[data-testid="supplier-offer-card"]')]
    .find((card) => card.textContent.includes("المورد الأخضر"));
  const incompleteCard = [...container.querySelectorAll('[data-testid="supplier-offer-card"]')]
    .find((card) => card.textContent.includes("المورد غير المتاح"));
  expect(completeCard.textContent).toContain("2 مختار");
  expect(incompleteCard.textContent).not.toContain("مختار");
  // Selection is a local comparison decision until the user explicitly saves;
  // it never invokes approval or any other workflow mutation automatically.
  expect(mockPost).not.toHaveBeenCalled();

  await act(async () => root.unmount());
  container.remove();
});

test("supplier footer adjustments persist and cheapest complete uses final total", async () => {
  const adjusted = {
    ...detail,
    supplier_offers: [
      { supplier_id: "supplier-1", supplier_code: "SUP-1", supplier_name: "المورد الأخضر", discount_pct: 0, tax_pct: 0, shipping_cost: 50, other_cost: 0 },
      { supplier_id: "supplier-2", supplier_code: "SUP-2", supplier_name: "المورد غير المتاح", discount_pct: 20, tax_pct: 0, shipping_cost: 0, other_cost: 0 },
    ],
    rows: [
      { ...detail.rows[0], id: "adjust-a1", item_id: "item-1", item_code: "ITM-1", product_name: "منتج أول", unit_price: 80 },
      { ...detail.rows[0], id: "adjust-a2", item_id: "item-2", item_code: "ITM-2", product_name: "منتج ثان", unit_price: 80 },
      { ...detail.rows[1], id: "adjust-b1", item_id: "item-1", item_code: "ITM-1", product_name: "منتج أول", availability: "available", unit_price: 90 },
      { ...detail.rows[1], id: "adjust-b2", item_id: "item-2", item_code: "ITM-2", product_name: "منتج ثان", availability: "available", unit_price: 90 },
    ],
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<SupplierPriceComparison initialComparison={adjusted} />); await new Promise((resolve) => setTimeout(resolve, 30)); });

  const cards = [...container.querySelectorAll('[data-testid="supplier-offer-card"]')];
  expect(cards[0].textContent).toContain("370.00");
  expect(cards[1].textContent).toContain("288.00");
  await act(async () => setNativeValue(
    container.querySelector('[data-testid="supplier-adjustment-discount_pct-supplier-2"]'), "60",
  ));
  expect(cards[1].textContent).toContain("144.00");

  await act(async () => container.querySelector('[data-testid="select-cheapest-complete-offer"]').click());
  expect(cards[1].textContent).toContain("2 مختار");
  expect(cards[0].textContent).not.toContain("مختار");

  await act(async () => {
    container.querySelector('[data-testid="comparison-save"]').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  const savedPayload = mockPut.mock.calls.find(([url]) => url === "/price-comparisons/comparison-1")?.[1];
  expect(savedPayload.supplier_offers.find((offer) => offer.supplier_id === "supplier-2")).toMatchObject({
    discount_pct: 60, shipping_cost: 0, other_cost: 0,
  });
  expect(savedPayload.rows.every((row) => !("discount_pct" in row) && !("shipping_cost" in row))).toBe(true);

  await act(async () => root.unmount());
  container.remove();
});

test("a withdrawn quotation cannot win cheapest complete selection", async () => {
  const withdrawn = {
    ...detail,
    source_rfq_id: "rfq-1",
    supplier_quotations: [{ id: "quotation-1", supplier_id: "supplier-1", supplier_name: "المورد الأخضر", status: "withdrawn", attachments: [] }],
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<SupplierPriceComparison initialComparison={withdrawn} />); await new Promise((resolve) => setTimeout(resolve, 30)); });

  await act(async () => container.querySelector('[data-testid="select-cheapest-complete-offer"]').click());
  expect(container.textContent).not.toContain("1 مختار");
  expect(mockPost).not.toHaveBeenCalled();

  await act(async () => root.unmount());
  container.remove();
});

test("shows source request attachments without extraction controls", async () => {
  const withAttachment = {
    ...detail,
    source_request_id: "request-1",
    source_request_number: "REQ-1",
    source_attachments: [{
      id: "attachment-1", original_filename: "site-request.png",
      item_label: "منتج اختبار", media_type: "image/png", is_image: true,
      view_url: "/internal/incoming-purchase-requests/request-1/attachments/attachment-1",
    }],
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<SupplierPriceComparison initialComparison={withAttachment} />); await new Promise((resolve) => setTimeout(resolve, 30)); });
  const sourceContext = container.querySelector('[data-testid="source-context"]');
  expect(sourceContext).not.toBeNull();
  expect(sourceContext.hasAttribute("open")).toBe(false);
  expect(container.querySelector('[data-testid="source-request-attachments"]')).not.toBeNull();
  expect(container.textContent).toContain("مرفقات طلب الشراء");
  expect(container.textContent).toContain("site-request.png");
  expect(container.textContent).not.toMatch(/OCR|استخراج تلقائي/);
  await act(async () => root.unmount());
  container.remove();
});

test("renders supplier quotation attachments inside the matching supplier offer", async () => {
  const withQuotationAttachment = {
    ...detail,
    source_rfq_id: "rfq-1",
    supplier_quotations: [{
      id: "quotation-1", supplier_id: "supplier-1", supplier_name: "المورد الأخضر",
      status: "received", attachments: [{
        id: "quote-file-1", original_filename: "supplier-offer.pdf",
        download_url: "/workflow/rfqs/rfq-1/quotations/quotation-1/attachments/quote-file-1",
      }],
    }],
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<SupplierPriceComparison initialComparison={withQuotationAttachment} />); await new Promise((resolve) => setTimeout(resolve, 30)); });

  const supplierCard = [...container.querySelectorAll('[data-testid="supplier-offer-card"]')]
    .find((card) => card.textContent.includes("المورد الأخضر"));
  expect(supplierCard.textContent).toContain("مستلم");
  expect(supplierCard.textContent).toContain("supplier-offer.pdf");
  expect(container.textContent).not.toContain("مرفق عام للمقارنة");

  await act(async () => root.unmount());
  container.remove();
});

describe("supplier quotation attachment open/download", () => {
  const ATTACHMENT_PATH = "/workflow/rfqs/rfq-1/quotations/quotation-1/attachments/quote-file-1";
  let originalOpen;
  let originalCreateObjectURL;
  let originalRevokeObjectURL;

  beforeEach(() => {
    originalOpen = window.open;
    originalCreateObjectURL = window.URL.createObjectURL;
    originalRevokeObjectURL = window.URL.revokeObjectURL;
    window.open = jest.fn();
    window.URL.createObjectURL = jest.fn(() => "blob:mock-url");
    window.URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    window.open = originalOpen;
    window.URL.createObjectURL = originalCreateObjectURL;
    window.URL.revokeObjectURL = originalRevokeObjectURL;
  });

  async function renderWithAttachment(attachmentOverrides, attachmentResponder) {
    const withQuotationAttachment = {
      ...detail,
      source_rfq_id: "rfq-1",
      supplier_quotations: [{
        id: "quotation-1", supplier_id: "supplier-1", supplier_name: "المورد الأخضر",
        status: "received", attachments: [{
          id: "quote-file-1", original_filename: "supplier-offer.pdf",
          download_url: ATTACHMENT_PATH, ...attachmentOverrides,
        }],
      }],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mockGet.mockImplementation((url, config) => (
      url === ATTACHMENT_PATH ? attachmentResponder(url, config) : getResponse(url)
    ));
    await act(async () => {
      root.render(<SupplierPriceComparison initialComparison={withQuotationAttachment} />);
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    return { container, root };
  }

  function findViewButton(container, filename) {
    return [...container.querySelectorAll("button")].find((button) => button.textContent.includes(filename));
  }

  afterEach(() => {
    mockGet.mockImplementation(getResponse);
  });

  test("opens a PDF attachment in a new tab once a valid blob is confirmed", async () => {
    const blob = new Blob(["%PDF-1.4 fake"], { type: "application/pdf" });
    const { container, root } = await renderWithAttachment(
      { media_type: "application/pdf" },
      () => Promise.resolve({ data: blob }),
    );

    await act(async () => {
      findViewButton(container, "supplier-offer.pdf").click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(mockGet).toHaveBeenCalledWith(ATTACHMENT_PATH, expect.objectContaining({ responseType: "blob" }));
    expect(window.URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(window.open).toHaveBeenCalledWith("blob:mock-url", "_blank", "noopener,noreferrer");

    await act(async () => root.unmount());
    container.remove();
  });

  test("downloads a non-viewable attachment (e.g. xlsx) with its original filename instead of opening a tab", async () => {
    const blob = new Blob(["xlsx-bytes"], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { container, root } = await renderWithAttachment(
      { original_filename: "supplier-offer.xlsx", media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      () => Promise.resolve({ data: blob }),
    );

    await act(async () => {
      findViewButton(container, "supplier-offer.xlsx").click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(window.open).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);

    clickSpy.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  });

  test("an API failure never opens a tab and shows the required toast instead of a stuck about:blank", async () => {
    const { container, root } = await renderWithAttachment(
      { media_type: "application/pdf" },
      () => Promise.reject({ response: { status: 500 } }),
    );

    await act(async () => {
      findViewButton(container, "supplier-offer.pdf").click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(window.open).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("تعذر فتح مرفق عرض المورد");

    await act(async () => root.unmount());
    container.remove();
  });

  test("an empty blob response is treated as a failure, not opened as a tab", async () => {
    const emptyBlob = new Blob([], { type: "application/pdf" });
    const { container, root } = await renderWithAttachment(
      { media_type: "application/pdf" },
      () => Promise.resolve({ data: emptyBlob }),
    );

    await act(async () => {
      findViewButton(container, "supplier-offer.pdf").click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(window.open).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("تعذر فتح مرفق عرض المورد");

    await act(async () => root.unmount());
    container.remove();
  });

  test.each([401, 403])("a %i on the attachment request uses the authenticated client and shows an error, not a blank tab", async (status) => {
    const { container, root } = await renderWithAttachment(
      { media_type: "application/pdf" },
      () => Promise.reject({ response: { status } }),
    );

    await act(async () => {
      findViewButton(container, "supplier-offer.pdf").click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(mockGet).toHaveBeenCalledWith(ATTACHMENT_PATH, expect.objectContaining({ responseType: "blob" }));
    expect(window.open).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("تعذر فتح مرفق عرض المورد");

    await act(async () => root.unmount());
    container.remove();
  });
});

test("adds, edits, and deletes a manual offer without saving master data", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SupplierPriceComparison initialComparison={detail} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  await act(async () => {
    container.querySelector('[data-testid="comparison-add-manual-product"]').click();
  });
  await act(async () => {
    setNativeValue(
      document.querySelector('[data-testid="manual-product-name"]'),
      "منتج يدوي",
    );
    setNativeValue(
      document.querySelector('[data-testid="manual-supplier-name"]'),
      "مورد يدوي",
    );
    setNativeValue(
      document.querySelector('[data-testid="offer-unit-price"]'),
      "200",
    );
  });
  await act(async () => {
    document.querySelector('[data-testid="offer-modal-save"]').click();
  });
  expect(container.textContent).toContain("منتج يدوي");
  expect(container.textContent).toContain("مورد يدوي");
  expect(mockPost).not.toHaveBeenCalled();

  // In the true matrix, the item name lives once in the shared item column
  // (not repeated inside every supplier cell); find the manual item's row
  // by its grid row index, then locate its cell among the supplier columns.
  const findRowByItemName = (name) => {
    const matrix = container.querySelector('[data-testid="comparison-matrix"]');
    const itemCell = [...matrix.children[0].children]
      .find((el) => el.textContent.includes(name) && el.style.gridColumn === "1");
    const gridRow = itemCell?.style.gridRow;
    return [...matrix.querySelectorAll('[data-testid="comparison-row"]')]
      .find((cell) => cell.style.gridRow === gridRow);
  };

  const manualRow = findRowByItemName("منتج يدوي");
  expect(manualRow).toBeTruthy();
  await act(async () => manualRow.querySelector('[title="تعديل"]').click());
  await act(async () => {
    setNativeValue(
      document.querySelector('[data-testid="offer-unit-price"]'),
      "225",
    );
    document.querySelector('[data-testid="offer-modal-save"]').click();
  });
  expect(container.textContent).toContain("225.00");

  const editedManualRow = findRowByItemName("منتج يدوي");
  expect(editedManualRow).toBeTruthy();
  await act(async () => editedManualRow.querySelector('[title="حذف"]').click());
  expect(container.querySelectorAll('[data-testid="comparison-row"]')).toHaveLength(2);
  expect(container.textContent).not.toContain("منتج يدوي");

  await act(async () => root.unmount());
  container.remove();
});

test("save-to-master remains separate and requires explicit confirmation", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SupplierPriceComparison />);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await act(async () => {
    container.querySelector('[data-testid="comparison-add-manual-product"]').click();
  });
  await act(async () => {
    setNativeValue(
      document.querySelector('[data-testid="manual-supplier-name"]'),
      "مورد للحفظ",
    );
    setNativeValue(
      document.querySelector('[data-testid="manual-product-name"]'),
      "منتج للمقارنة",
    );
  });
  await act(async () => {
    document.querySelector('[data-testid="save-manual-supplier"]').click();
  });
  expect(mockPost).not.toHaveBeenCalled();
  expect(document.querySelector('[data-testid="save-master-confirmation"]')).not.toBeNull();
  await act(async () => {
    document.querySelector('[data-testid="confirm-save-master"]').click();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(mockPost).toHaveBeenCalledWith("/suppliers", { name: "مورد للحفظ" });

  await act(async () => root.unmount());
  container.remove();
});

const findRowCellByItemName = (container, name) => {
  const matrix = container.querySelector('[data-testid="comparison-matrix"]');
  const itemCell = [...matrix.children[0].children]
    .find((el) => el.textContent.includes(name) && el.style.gridColumn === "1");
  return itemCell;
};

test("a manual (not-in-catalog) item shows a badge and add-to-catalog button; a linked item does not", async () => {
  const manualDetail = {
    ...detail,
    rows: [{ ...detail.rows[0], item_id: "", item_code: "", manual_product_key: "manual-key-1", product_name: "صنف يدوي بدون دليل" }],
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SupplierPriceComparison initialComparison={manualDetail} />);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  const manualCell = findRowCellByItemName(container, "صنف يدوي بدون دليل");
  expect(manualCell.textContent).toContain("صنف يدوي");
  expect(manualCell.querySelector('[data-testid^="add-to-catalog-"]')).not.toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("a catalog-linked item never shows the add-to-catalog button", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SupplierPriceComparison initialComparison={detail} />);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  const linkedCell = findRowCellByItemName(container, "منتج اختبار");
  expect(linkedCell.querySelector('[data-testid^="add-to-catalog-"]')).toBeNull();
  expect(linkedCell.textContent).not.toContain("صنف يدوي");

  await act(async () => root.unmount());
  container.remove();
});

test("adding a manual item to the catalog links the existing row without losing it", async () => {
  const manualDetail = {
    ...detail,
    rows: [{ ...detail.rows[0], item_id: "", item_code: "", manual_product_key: "manual-key-2", product_name: "صنف يدوي للربط", main_category: "دهانات", subcategory: "دهانات داخلية", unit: "جالون" }],
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SupplierPriceComparison initialComparison={manualDetail} />);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  await act(async () => {
    findRowCellByItemName(container, "صنف يدوي للربط")
      .querySelector('[data-testid^="add-to-catalog-"]').click();
  });
  expect(document.querySelector('[data-testid="add-to-catalog-dialog"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="catalog-form-name"]').value).toBe("صنف يدوي للربط");
  expect(document.querySelector('[data-testid="catalog-form-unit"]').value).toBe("جالون");

  await act(async () => {
    document.querySelector('[data-testid="catalog-form-submit"]').click();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  expect(mockPost).toHaveBeenCalledWith("/items", expect.objectContaining({
    name: "صنف يدوي للربط", main_category: "دهانات", subcategory: "دهانات داخلية", unit: "جالون",
  }));
  // The row survives the conversion (not dropped/recreated) and now points
  // at the newly created master item - the badge/button disappear.
  expect(container.querySelectorAll('[data-testid="comparison-row"]')).toHaveLength(1);
  expect(container.textContent).toContain("صنف يدوي للربط");
  const linkedCell = findRowCellByItemName(container, "صنف يدوي للربط");
  expect(linkedCell.querySelector('[data-testid^="add-to-catalog-"]')).toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

function mockLastFormalPrices(prices) {
  mockGet.mockImplementation((url, config) => {
    if (url === "/price-comparisons/last-formal-prices") {
      return Promise.resolve({ data: { prices } });
    }
    return getResponse(url, config);
  });
}

async function renderComparison(comparisonDetail = detail) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SupplierPriceComparison initialComparison={comparisonDetail} />);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  return { container, root };
}

test("the comparison matrix shows the last formal price for the same supplier and item, and an explicit empty state otherwise", async () => {
  mockLastFormalPrices({
    "item-1|supplier-1": { unit_price: 1250, date: "2026-08-10", quotation_id: "q-1" },
  });
  const { container, root } = await renderComparison();

  const priceCells = container.querySelectorAll('[data-testid^="last-supplier-price-"]');
  expect(priceCells.length).toBe(2);
  // row-1: item-1/supplier-1, current unit_price 100 vs. previous 1250 -> down.
  const withPrice = [...priceCells].find((el) => el.textContent.includes("1250.00"));
  // row-2: item-1/supplier-2 has no matching last-formal-prices entry.
  const withoutPrice = [...priceCells].find((el) => el.textContent.includes("لا يوجد سعر رسمي سابق"));
  expect(withPrice).toBeTruthy();
  expect(withPrice.getAttribute("title")).toContain("2026-08-10");
  expect(withPrice.textContent).toContain("-92.0%");
  expect(withoutPrice).toBeTruthy();
  // The editable current-price input is untouched and still holds row-1's
  // real current price (100), not the previous formal price (1250).
  expect(container.querySelector('[data-testid="inline-unit-price-row-1"]').value).toBe("100");

  await act(async () => root.unmount());
  container.remove();
});

test("current 120 / previous 100 displays +20% with an up indicator", async () => {
  mockLastFormalPrices({ "item-1|supplier-1": { unit_price: 100, date: "2026-08-01", quotation_id: "q-1" } });
  const upDetail = { ...detail, rows: [{ ...detail.rows[0], unit_price: 120 }] };
  const { container, root } = await renderComparison(upDetail);

  const cell = container.querySelector('[data-testid="last-supplier-price-row-1"]');
  expect(cell.textContent).toContain("+20.0%");
  const indicator = container.querySelector('[data-testid="price-change-indicator-row-1"]');
  expect(indicator.className).toEqual(expect.stringContaining("amber"));

  await act(async () => root.unmount());
  container.remove();
});

test("current 80 / previous 100 displays -20% with a down indicator", async () => {
  mockLastFormalPrices({ "item-1|supplier-1": { unit_price: 100, date: "2026-08-01", quotation_id: "q-1" } });
  const downDetail = { ...detail, rows: [{ ...detail.rows[0], unit_price: 80 }] };
  const { container, root } = await renderComparison(downDetail);

  const cell = container.querySelector('[data-testid="last-supplier-price-row-1"]');
  expect(cell.textContent).toContain("-20.0%");
  const indicator = container.querySelector('[data-testid="price-change-indicator-row-1"]');
  expect(indicator.className).toEqual(expect.stringContaining("emerald"));

  await act(async () => root.unmount());
  container.remove();
});

test("current 100 / previous 100 shows the unchanged state, not a percentage", async () => {
  mockLastFormalPrices({ "item-1|supplier-1": { unit_price: 100, date: "2026-08-01", quotation_id: "q-1" } });
  const sameDetail = { ...detail, rows: [{ ...detail.rows[0], unit_price: 100 }] };
  const { container, root } = await renderComparison(sameDetail);

  const cell = container.querySelector('[data-testid="last-supplier-price-row-1"]');
  expect(cell.textContent).toContain("نفس السعر السابق");
  expect(cell.textContent).not.toMatch(/%/);

  await act(async () => root.unmount());
  container.remove();
});

test("previous = 0 shows the direction without a percentage, never a division error", async () => {
  mockLastFormalPrices({ "item-1|supplier-1": { unit_price: 0, date: "2026-08-01", quotation_id: "q-1" } });
  const { container, root } = await renderComparison();

  const cell = container.querySelector('[data-testid="last-supplier-price-row-1"]');
  expect(cell.textContent).not.toMatch(/%/);
  expect(cell.textContent).not.toContain("NaN");
  expect(cell.textContent).not.toContain("Infinity");

  await act(async () => root.unmount());
  container.remove();
});

test("a received quotation is never shown as its own previous price - the exclusion token reaches the API", async () => {
  globalThis.mockComparisonLocationState = {
    supplierQuotations: [{ id: "current-q-1", supplier_id: "supplier-1", status: "received" }],
  };
  mockLastFormalPrices({});
  const { container, root } = await renderComparison();

  const call = mockGet.mock.calls.find(([url]) => url === "/price-comparisons/last-formal-prices");
  expect(call).toBeTruthy();
  expect(call[1].params.pairs).toContain("item-1:supplier-1:current-q-1");

  await act(async () => root.unmount());
  container.remove();
  globalThis.mockComparisonLocationState = null;
});

// ---------------- Non-cheapest supplier selection reason ----------------

function twoSupplierDetail(overrides = {}) {
  return {
    id: "comparison-2", comparison_number: "CMP-000002", comparison_date: "2026-07-28",
    project_name: "مشروع", customer_name: "عميل", notes: "",
    rows: [
      {
        id: "row-cheap", item_id: "item-1", supplier_id: "supplier-1", quantity: 2,
        item_code: "ITM-1", product_name: "منتج اختبار", brand: "A",
        main_category: "رئيسي", subcategory: "فرعي", specifications: "مواصفة",
        supplier_code: "SUP-1", supplier_name: "المورد الأخضر",
        unit: "قطعة", unit_price: 100, discount_pct: 0, tax_pct: 0,
        shipping_cost: 0, other_cost: 0, delivery_days: 5, payment_terms: "نقدي",
        availability: "available", price_valid_until: "2099-12-31", notes: "",
        selected_for_purchase: 0,
      },
      {
        id: "row-expensive", item_id: "item-1", supplier_id: "supplier-2", quantity: 2,
        item_code: "ITM-1", product_name: "منتج اختبار", brand: "A",
        main_category: "رئيسي", subcategory: "فرعي", specifications: "مواصفة",
        supplier_code: "SUP-2", supplier_name: "المورد الثاني",
        unit: "قطعة", unit_price: 120, discount_pct: 0, tax_pct: 0,
        shipping_cost: 0, other_cost: 0, delivery_days: 2, payment_terms: "",
        availability: "available", price_valid_until: "2099-12-31", notes: "",
        selected_for_purchase: 1,
      },
    ],
    ...overrides,
  };
}

function mockApprovalCreation() {
  mockPost.mockImplementation((url) => {
    if (url === "/workflow/approvals/from-comparison") {
      return Promise.resolve({ data: { approval: { id: "approval-1", approval_number: "APR-000099" } } });
    }
    return Promise.resolve({ data: detail });
  });
}

test("selecting the cheapest supplier needs no reason UI and sends directly", async () => {
  mockLastFormalPrices({});
  mockApprovalCreation();
  const cheapSelected = twoSupplierDetail({
    rows: [
      { ...twoSupplierDetail().rows[0], selected_for_purchase: 1 },
      { ...twoSupplierDetail().rows[1], selected_for_purchase: 0 },
    ],
  });
  const { container, root } = await renderComparison(cheapSelected);

  expect(container.querySelector('[data-testid="non-cheapest-summary-indicator"]')).toBeNull();
  await act(async () => { container.querySelector('[data-testid="comparison-summary-send"]').click(); });
  expect(container.querySelector('[data-testid="non-cheapest-reason-dialog"]')).toBeNull();
  expect(mockPost).toHaveBeenCalledWith("/workflow/approvals/from-comparison", expect.objectContaining({
    decision_reasons: [],
  }));

  await act(async () => root.unmount());
  container.remove();
});

test("selecting a non-cheapest supplier shows the reason dialog at the send boundary with correct totals/difference", async () => {
  mockLastFormalPrices({});
  mockApprovalCreation();
  const { container, root } = await renderComparison(twoSupplierDetail());

  const indicator = container.querySelector('[data-testid="non-cheapest-summary-indicator"]');
  expect(indicator).not.toBeNull();
  expect(indicator.textContent).toContain("1");
  expect(container.querySelector('[data-testid^="non-cheapest-badge-"]')).not.toBeNull();

  await act(async () => { container.querySelector('[data-testid="comparison-summary-send"]').click(); });
  expect(mockPost).not.toHaveBeenCalledWith("/workflow/approvals/from-comparison", expect.anything());
  const dialog = container.querySelector('[data-testid="non-cheapest-reason-dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog.textContent).toContain("240.00");
  expect(dialog.textContent).toContain("200.00");

  await act(async () => root.unmount());
  container.remove();
});

test("a predefined reason is accepted and reaches the API", async () => {
  mockLastFormalPrices({});
  mockApprovalCreation();
  const { container, root } = await renderComparison(twoSupplierDetail());

  await act(async () => { container.querySelector('[data-testid="comparison-summary-send"]').click(); });
  const select = container.querySelector('[data-testid^="non-cheapest-reason-select-"]');
  await act(async () => {
    select.value = "better_delivery";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector('[data-testid="confirm-non-cheapest-reasons"]').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(mockPost).toHaveBeenCalledWith("/workflow/approvals/from-comparison", expect.objectContaining({
    decision_reasons: [expect.objectContaining({
      item_id: "item-1", reason_code: "better_delivery", reason_text: "",
    })],
  }));
  expect(container.querySelector('[data-testid="non-cheapest-reason-dialog"]')).toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("choosing Other without a note is blocked; adding the note allows sending", async () => {
  mockLastFormalPrices({});
  mockApprovalCreation();
  const { container, root } = await renderComparison(twoSupplierDetail());

  await act(async () => { container.querySelector('[data-testid="comparison-summary-send"]').click(); });
  const select = container.querySelector('[data-testid^="non-cheapest-reason-select-"]');
  await act(async () => {
    select.value = "other";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => { container.querySelector('[data-testid="confirm-non-cheapest-reasons"]').click(); });
  expect(mockPost).not.toHaveBeenCalledWith("/workflow/approvals/from-comparison", expect.anything());
  expect(container.querySelector('[data-testid="non-cheapest-reason-dialog"]')).not.toBeNull();

  const textInput = container.querySelector('[data-testid^="non-cheapest-reason-text-"]');
  await act(async () => setNativeValue(textInput, "طلب خاص من العميل"));
  await act(async () => {
    container.querySelector('[data-testid="confirm-non-cheapest-reasons"]').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(mockPost).toHaveBeenCalledWith("/workflow/approvals/from-comparison", expect.objectContaining({
    decision_reasons: [expect.objectContaining({
      reason_code: "other", reason_text: "طلب خاص من العميل",
    })],
  }));

  await act(async () => root.unmount());
  container.remove();
});

test("editing the price so the selected supplier becomes cheapest removes the requirement", async () => {
  mockLastFormalPrices({});
  mockApprovalCreation();
  const { container, root } = await renderComparison(twoSupplierDetail());

  expect(container.querySelector('[data-testid="non-cheapest-summary-indicator"]')).not.toBeNull();

  // Procurement edits the selected (expensive) supplier's price down below
  // the other row's - it is now genuinely the cheapest. The edit is local
  // state (matrix input), immediately re-evaluated with no save needed.
  const priceInput = container.querySelector('[data-testid="inline-unit-price-row-expensive"]');
  await act(async () => setNativeValue(priceInput, "50"));
  expect(container.querySelector('[data-testid="non-cheapest-summary-indicator"]')).toBeNull();

  // Sending still requires a save first (existing, unrelated guard) - save
  // with the same cheaper price so the persisted comparison matches.
  const cheaperDetail = twoSupplierDetail({
    rows: [
      twoSupplierDetail().rows[0],
      { ...twoSupplierDetail().rows[1], unit_price: 50 },
    ],
  });
  mockPut.mockResolvedValue({ data: cheaperDetail });
  await act(async () => {
    container.querySelector('[data-testid="comparison-save"]').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  await act(async () => { container.querySelector('[data-testid="comparison-summary-send"]').click(); });
  expect(container.querySelector('[data-testid="non-cheapest-reason-dialog"]')).toBeNull();
  expect(mockPost).toHaveBeenCalledWith("/workflow/approvals/from-comparison", expect.objectContaining({
    decision_reasons: [],
  }));

  await act(async () => root.unmount());
  container.remove();
});

test("historical indicator does not replace or disable the editable current price control", async () => {
  mockLastFormalPrices({ "item-1|supplier-1": { unit_price: 100, date: "2026-08-01", quotation_id: "q-1" } });
  const { container, root } = await renderComparison();

  const input = container.querySelector('[data-testid="inline-unit-price-row-1"]');
  expect(input).toBeTruthy();
  expect(input.tagName).toBe("INPUT");
  expect(input.disabled).toBe(false);
  expect(input.value).toBe("100");

  await act(async () => root.unmount());
  container.remove();
});
