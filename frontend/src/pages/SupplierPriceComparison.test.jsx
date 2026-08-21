import React, { act } from "react";
import { createRoot } from "react-dom/client";

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

jest.mock("@/lib/api", () => ({
  __esModule: true,
  fmt: (value) => Number(value || 0).toFixed(2),
  errMsg: () => "خطأ",
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
    put: jest.fn(),
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
  mockPost.mockImplementation((url, body) => {
    if (url === "/suppliers") return Promise.resolve({
      data: { id: "saved-supplier", code: "SUP-9999", name: body.name },
    });
    if (url === "/items") return Promise.resolve({
      data: { id: "saved-item", code: "MAT-9999", ...body },
    });
    return Promise.resolve({ data: detail });
  });
});

test("adds repeated request items as separate aligned supplier-card rows", async () => {
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
  expect(container.querySelectorAll('[data-testid="comparison-row"]')).toHaveLength(2);
  expect(container.querySelectorAll('[data-testid="supplier-offer-card"]')).toHaveLength(2);
  expect(container.textContent).toContain("عرض غير مكتمل");

  await act(async () => container.querySelector('[data-testid="add-all-request-items"]').click());
  expect(container.querySelectorAll('[data-testid="comparison-row"]')).toHaveLength(3);

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
    "Comparison details", "Add supplier offer", "Added offers",
    "Product comparison", "Supplier summary", "Mixed purchase and savings summary",
    "Save comparison", "Print", "All products", "Availability",
  ]) expect(container.textContent).toContain(label);
  expect(container.textContent).not.toContain("بيانات المقارنة");

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
  expect(renderedRows.some((row) => row.className.includes("bg-emerald-50"))).toBe(true);
  expect(renderedRows.some((row) => row.className.includes("bg-red-50"))).toBe(true);
  expect(container.textContent).toContain("المورد الأخضر");
  expect(container.textContent).toContain("المورد غير المتاح");
  for (const section of [
    "1 — بيانات المقارنة", "2 — إضافة عرض مورد", "3 — العروض المضافة",
    "4 — مقارنة المنتجات", "5 — ملخص الموردين", "6 — ملخص الشراء المختلط والتوفير",
  ]) expect(container.textContent).toContain(section);
  expect(container.querySelectorAll('[data-testid="supplier-offer-card"]')).toHaveLength(2);
  expect(container.querySelector('[data-testid="select-cheapest-complete-offer"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="offers-category-filter"] option[value="رئيسي"]')).not.toBeNull();
  await act(async () => container.querySelector('[data-testid="comparison-print"]').click());
  expect(window.print).toHaveBeenCalledTimes(1);

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

  const manualRow = [...container.querySelectorAll('[data-testid="comparison-row"]')]
    .find((row) => row.textContent.includes("منتج يدوي"));
  await act(async () => manualRow.querySelector('[title="تعديل"]').click());
  await act(async () => {
    setNativeValue(
      document.querySelector('[data-testid="offer-unit-price"]'),
      "225",
    );
    document.querySelector('[data-testid="offer-modal-save"]').click();
  });
  expect(container.textContent).toContain("225.00");

  const editedManualRow = [...container.querySelectorAll('[data-testid="comparison-row"]')]
    .find((row) => row.textContent.includes("منتج يدوي"));
  await act(async () => editedManualRow.querySelector('[title="حذف"]').click());
  expect(container.querySelectorAll('[data-testid="comparison-row"]')).toHaveLength(2);
  expect([...container.querySelectorAll('[data-testid="comparison-row"]')]
    .some((row) => row.textContent.includes("منتج يدوي"))).toBe(false);

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
    container.querySelector('[data-testid="comparison-add-manual-supplier"]').click();
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
