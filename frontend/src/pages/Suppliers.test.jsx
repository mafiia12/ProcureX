import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Suppliers from "@/pages/Suppliers";

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

const supplierRow = {
  id: "supplier-1", code: "SUP-1", name: "مورد اختبار", specialty: "تشطيبات",
  group_name: "محلي", phone: "01000000000", city: "القاهرة", whatsapp: "01000000000",
  contact_person: "أحمد", email: "supplier@example.com", address: "شارع الحرية",
  payment_terms: "آجل 30 يوم", lead_time_days: 5, status: "نشط",
  formal_po_total: 500, formal_po_count: 3, last_formal_po_date: "2026-08-18",
  last_procurement_date: "2026-08-18", direct_purchase_count: 2, direct_purchase_total: 200,
};

async function renderSuppliers(rows = [supplierRow]) {
  mockGet.mockResolvedValue({ data: rows });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Suppliers />);
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

async function openMenu(element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = "";
});

test("shows only the compact supplier columns and hides removed fields from the main table", async () => {
  const { container, root } = await renderSuppliers();

  expect(mockGet).toHaveBeenCalledWith("/suppliers", { params: { include_procurement: true } });
  expect(container.querySelector('[data-testid="suppliers-management-header"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="suppliers-management-toolbar"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="suppliers-row"]').classList.contains("h-[34px]")).toBe(true);
  expect(container.querySelector('[data-testid="suppliers-table-viewport"]').classList.contains("max-h-[calc(100dvh-149px)]")).toBe(true);
  expect(container.textContent).toContain("كود المورد");
  expect(container.textContent).toContain("مورد اختبار");
  expect(container.textContent).toContain("01000000000");
  expect(container.textContent).toContain("القاهرة");
  expect(container.textContent).toContain("نشط");

  expect(container.textContent).not.toContain("المجموعة");
  expect(container.textContent).not.toContain("قيمة PO الرسمية");
  expect(container.textContent).not.toContain("آخر نشاط");
  expect(container.textContent).not.toContain("500 ج.م");
  expect(container.textContent).not.toContain("شراء مباشر");

  await act(async () => root.unmount());
  container.remove();
});

test("search filters the supplier list", async () => {
  const other = { ...supplierRow, id: "supplier-2", code: "SUP-2", name: "مورد آخر", phone: "01099999999" };
  const { container, root } = await renderSuppliers([supplierRow, other]);

  const search = container.querySelector('[data-testid="suppliers-search-input"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(search, "مورد آخر");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });

  expect(container.textContent).toContain("مورد آخر");
  expect(container.textContent).not.toContain("مورد اختبار");

  await act(async () => root.unmount());
  container.remove();
});

test("opens the supplier drawer with contact, business, and procurement reference details", async () => {
  const { container, root } = await renderSuppliers();

  await click(container.querySelector('[data-testid="suppliers-row"]'));

  const drawer = document.querySelector('[data-testid="suppliers-drawer"]');
  expect(drawer).not.toBeNull();
  expect(drawer.textContent).toContain("مورد اختبار");
  expect(drawer.textContent).toContain("أحمد");
  expect(drawer.textContent).toContain("supplier@example.com");
  expect(drawer.textContent).toContain("آجل 30 يوم");
  expect(drawer.textContent).toContain("2026-08-18");

  await act(async () => root.unmount());
  container.remove();
});

test("drawer navigates to price history and existing row action still works", async () => {
  const { container, root } = await renderSuppliers();

  await click(container.querySelector('[data-testid="suppliers-row"]'));
  const historyButtons = Array.from(document.querySelectorAll("button")).filter((b) => b.textContent.includes("تاريخ الأسعار"));
  await click(historyButtons[0]);
  expect(mockNavigate).toHaveBeenCalledWith("/price-history", { state: { supplier: "مورد اختبار" } });

  await act(async () => root.unmount());
  container.remove();
});

test("basic Add Supplier fields are visible immediately and additional details are collapsed", async () => {
  const { container, root } = await renderSuppliers([]);

  await click(container.querySelector('[data-testid="suppliers-add-button"]'));

  expect(document.querySelector('[data-testid="suppliers-form-name"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="suppliers-form-specialty"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="suppliers-form-phone"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="suppliers-form-city"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="suppliers-form-status"]')).not.toBeNull();

  expect(document.querySelector('[data-testid="suppliers-form-group_name"]')).toBeNull();
  expect(document.querySelector('[data-testid="suppliers-form-whatsapp"]')).toBeNull();
  expect(document.querySelector('[data-testid="suppliers-form-payment_terms"]')).toBeNull();

  await click(document.querySelector('[data-testid="suppliers-advanced-toggle"]'));
  expect(document.querySelector('[data-testid="suppliers-form-group_name"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="suppliers-form-whatsapp"]')).not.toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("saving a new supplier preserves the existing create behavior", async () => {
  mockPost.mockResolvedValue({ data: { id: "new", code: "SUP-9", name: "مورد جديد" } });
  const { container, root } = await renderSuppliers([]);
  await click(container.querySelector('[data-testid="suppliers-add-button"]'));

  const nameInput = document.querySelector('[data-testid="suppliers-form-name"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(nameInput, "مورد جديد");
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await click(document.querySelector('[data-testid="suppliers-save-button"]'));

  expect(mockPost).toHaveBeenCalledWith(
    "/suppliers",
    expect.objectContaining({ name: "مورد جديد", status: "نشط" }),
  );

  await act(async () => root.unmount());
  container.remove();
});

test("edit menu opens the pre-filled form with the generated code read-only", async () => {
  const { container, root } = await renderSuppliers();

  await openMenu(container.querySelector('[data-testid="suppliers-actions"]'));
  await click(document.querySelector('[data-testid="suppliers-edit-button"]'));

  const codeInput = document.querySelector('[data-testid="suppliers-form-code"]');
  expect(codeInput).not.toBeNull();
  expect(codeInput.value).toBe("SUP-1");
  expect(codeInput.readOnly).toBe(true);
  expect(document.querySelector('[data-testid="suppliers-form-name"]').value).toBe("مورد اختبار");

  await act(async () => root.unmount());
  container.remove();
});
