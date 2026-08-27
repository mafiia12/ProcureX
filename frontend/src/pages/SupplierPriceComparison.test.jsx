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
    "Comparison details", "Supplier offers", "Add supplier column",
    "Save comparison", "Print", "Advanced filters", "All availability states",
  ]) expect(container.textContent).toContain(label);
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

test("mixed-selection summary appears only once items are selected from more than one supplier", async () => {
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

  const mixed = container.querySelector('[data-testid="mixed-selection-summary"]');
  expect(mixed).not.toBeNull();
  expect(mixed.textContent).toContain("المورد الأخضر");
  expect(mixed.textContent).toContain("المورد غير المتاح");

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
  for (const section of [
    "1 — بيانات المقارنة", "2 — عروض الموردين",
    "3 — مقارنة المنتجات", "4 — ملخص الموردين", "5 — ملخص الشراء المختلط والتوفير",
  ]) expect(container.textContent).toContain(section);
  expect(container.querySelectorAll('[data-testid="supplier-offer-card"]')).toHaveLength(2);
  expect(container.querySelector('[data-testid="select-cheapest-complete-offer"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="offers-category-filter"] option[value="رئيسي"]')).not.toBeNull();
  await act(async () => container.querySelector('[data-testid="comparison-print"]').click());
  expect(window.print).toHaveBeenCalledTimes(1);

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
  expect(matrix.querySelectorAll('[data-testid="complete-offer-badge"]')).toHaveLength(1);
  expect(matrix.querySelectorAll('[data-testid="incomplete-offer-badge"]')).toHaveLength(1);
  expect(matrix.querySelectorAll('[data-testid="lowest-offer-badge"]')).toHaveLength(1);
  expect(matrix.querySelectorAll('[data-testid="not-offered-badge"]')).toHaveLength(1);
  expect(matrix.querySelectorAll('[data-testid="supplier-offer-summary"]')).toHaveLength(2);
  const priceInput = matrix.querySelector('[data-testid^="inline-unit-price-"]');
  expect(priceInput.classList.contains("h-6")).toBe(true);
  expect(priceInput.classList.contains("tabular-nums")).toBe(true);
  const itemCell = [...matrix.children[0].children]
    .find((element) => element.style.gridColumn === "1" && element.style.gridRow === "2");
  expect(itemCell.classList.contains("sticky")).toBe(true);
  expect(itemCell.classList.contains("py-1")).toBe(true);

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
  expect(supplierCard.textContent).toContain("مرفق عرض المورد");
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
