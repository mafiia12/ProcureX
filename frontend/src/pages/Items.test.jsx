import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Items from "@/pages/Items";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }), { virtual: true });
jest.mock("@/lib/api", () => ({
  __esModule: true,
  fmtEGP: (value) => `${value || 0} ج.م`,
  errMsg: () => "خطأ",
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
    put: (...args) => mockPut(...args),
    delete: jest.fn(),
  },
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const itemRow = {
  id: "item-1", code: "ITM-1", product_name: "دهان أبيض", main_category: "دهانات",
  subcategory: "دهانات داخلية", unit: "جالون", brand: "ماركة أ",
  specifications: "مواصفات تجريبية", notes: "ملاحظة", name: "دهان أبيض (قديم)",
  preferred_supplier: "مورد مفضل", last_price: 150, last_supplier: "مورد سابق",
  last_date: "2026-08-18",
  last_formal_price: 150, last_formal_supplier: "مورد سابق", last_formal_date: "2026-08-18",
};

async function renderItems(rows = [itemRow]) {
  mockGet.mockResolvedValue({ data: rows });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Items />);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  return { container, root };
}

async function click(element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = "";
});

test("shows only the compact item columns and hides removed fields from the main table", async () => {
  const { container, root } = await renderItems();

  expect(mockGet).toHaveBeenCalledWith("/items", { params: { limit: 50, offset: 0 } });
  expect(container.querySelector('[data-testid="items-management-header"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="items-management-toolbar"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="items-row"]').classList.contains("h-[34px]")).toBe(true);
  expect(container.querySelector('[data-testid="items-table-viewport"]').classList.contains("max-h-[calc(100dvh-149px)]")).toBe(true);
  expect(container.textContent).toContain("كود الصنف");
  expect(container.textContent).toContain("دهان أبيض");
  expect(container.textContent).toContain("دهانات");
  expect(container.textContent).toContain("جالون");
  expect(container.textContent).toContain("150 ج.م");
  expect(container.textContent).toContain("مورد سابق");

  expect(container.textContent).not.toContain("التصنيف الفرعي");
  expect(container.textContent).not.toContain("آخر نشاط");
  expect(container.textContent).not.toContain("2026-08-18");

  await act(async () => root.unmount());
  container.remove();
});

test("search filters the item list", async () => {
  const other = { ...itemRow, id: "item-2", code: "ITM-2", product_name: "دهان أزرق" };
  const { container, root } = await renderItems([itemRow, other]);

  const search = container.querySelector('[data-testid="items-search-input"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(search, "أزرق");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });

  expect(container.textContent).toContain("دهان أزرق");
  expect(container.textContent).not.toContain("دهان أبيض");
  const clear = container.querySelector('[data-testid="items-clear-filters"]');
  expect(clear).not.toBeNull();
  await click(clear);
  expect(container.textContent).toContain("دهان أبيض");
  expect(container.textContent).toContain("دهان أزرق");

  await act(async () => root.unmount());
  container.remove();
});

test("opens the item drawer with primary and procurement info", async () => {
  const { container, root } = await renderItems();

  await click(container.querySelector('[data-testid="items-row"]'));

  const drawer = document.querySelector('[data-testid="items-drawer"]');
  expect(drawer).not.toBeNull();
  expect(drawer.textContent).toContain("دهان أبيض");
  expect(drawer.textContent).toContain("دهانات داخلية");
  expect(drawer.textContent).toContain("150 ج.م");
  expect(drawer.textContent).toContain("مورد سابق");
  expect(drawer.textContent).toContain("مورد مفضل");

  await act(async () => root.unmount());
  container.remove();
});

test("drawer price-history action navigates like the row action", async () => {
  const { container, root } = await renderItems();

  await click(container.querySelector('[data-testid="items-row"]'));
  const historyButtons = Array.from(document.querySelectorAll("button")).filter((b) => b.textContent.includes("تاريخ الأسعار"));
  await click(historyButtons[0]);
  expect(mockNavigate).toHaveBeenCalledWith("/price-history", { state: { item: "دهان أبيض", itemCode: "ITM-1" } });

  await act(async () => root.unmount());
  container.remove();
});

test("basic Add Item fields are visible immediately and additional details are collapsed", async () => {
  const { container, root } = await renderItems([]);

  await click(container.querySelector('[data-testid="items-add-button"]'));

  expect(document.querySelector('[data-testid="items-form-product_name"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="items-form-main_category"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="items-form-unit"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="items-form-code"]')).toBeNull();

  expect(document.querySelector('[data-testid="items-form-subcategory"]')).toBeNull();
  expect(document.querySelector('[data-testid="items-form-brand"]')).toBeNull();
  expect(document.querySelector('[data-testid="items-form-notes"]')).toBeNull();

  await click(document.querySelector('[data-testid="items-advanced-toggle"]'));
  expect(document.querySelector('[data-testid="items-form-subcategory"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="items-form-brand"]')).not.toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("saving a new item preserves the existing create behavior", async () => {
  mockPost.mockResolvedValue({ data: { id: "new", code: "ITM-9", product_name: "صنف جديد" } });
  const { container, root } = await renderItems([]);
  await click(container.querySelector('[data-testid="items-add-button"]'));

  const nameInput = document.querySelector('[data-testid="items-form-product_name"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(nameInput, "صنف جديد");
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await click(document.querySelector('[data-testid="items-save-button"]'));

  expect(mockPost).toHaveBeenCalledWith(
    "/items",
    expect.objectContaining({ product_name: "صنف جديد" }),
  );

  await act(async () => root.unmount());
  container.remove();
});

test("edit menu opens the pre-filled form with the generated code read-only", async () => {
  const { container, root } = await renderItems();

  await act(async () => {
    container.querySelector('[data-testid="items-actions"]').dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  await click(document.querySelector('[data-testid="items-edit-button"]'));

  const codeInput = document.querySelector('[data-testid="items-form-code"]');
  expect(codeInput).not.toBeNull();
  expect(codeInput.value).toBe("ITM-1");
  expect(codeInput.readOnly).toBe(true);
  expect(document.querySelector('[data-testid="items-form-product_name"]').value).toBe("دهان أبيض");

  await act(async () => root.unmount());
  container.remove();
}, 15000);
