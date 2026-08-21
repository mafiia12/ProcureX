import React, { act } from "react";
import { createRoot } from "react-dom/client";

import PurchaseOrders from "@/pages/PurchaseOrders";


globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const orders = [
  {
    id: "po-1", po_number: "PO-000001", project_name: "مشروع أ",
    supplier_name: "مورد أ", status: "draft", final_total: 100,
    po_date: "2026-08-16", item_count: 1, updated_at: "2026-08-16T10:00:00Z",
    source_request_number: "REQ-1", comparison_number: "CMP-1", approval_number: "APR-1",
    workflow: { expenditure_approved: false, funds_released: false },
    payment_summary: {
      po_total: 100, paid_amount: 0, outstanding_amount: 100,
      payment_status: "not_due", is_overdue: false, due_date: null,
    },
  },
  {
    id: "po-2", po_number: "PO-000002", project_name: "مشروع ب",
    supplier_name: "مورد ب", status: "approved", final_total: 200,
    po_date: "2026-08-16", item_count: 2, updated_at: "2026-08-16T11:00:00Z",
    source_request_number: "REQ-2", comparison_number: "CMP-2", approval_number: "APR-2",
    workflow: { expenditure_approved: true, funds_released: true },
    payment_summary: {
      po_total: 200, paid_amount: 200, outstanding_amount: 0,
      payment_status: "paid", is_overdue: false, due_date: null,
    },
  },
];
const mockGet = jest.fn(() => Promise.resolve({ data: orders }));
const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}), { virtual: true });

jest.mock("@/lib/api", () => ({
  __esModule: true,
  fmt: (value) => Number(value || 0).toFixed(2),
  fmtEGP: (value) => `${Number(value || 0).toFixed(2)} ج.م`,
  errMsg: () => "خطأ",
  default: {
    get: (...args) => mockGet(...args),
    delete: jest.fn(() => Promise.resolve({ data: { ok: true } })),
  },
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

beforeEach(() => {
  mockGet.mockImplementation(() => Promise.resolve({ data: orders }));
  mockNavigate.mockClear();
});

test("filters purchase orders and opens the dedicated review page", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PurchaseOrders />);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  expect(mockGet).toHaveBeenCalledWith("/purchase-orders");
  expect(container.textContent).toContain("PO-000001");
  expect(container.querySelectorAll('[data-testid="purchase-order-row"]')).toHaveLength(2);
  expect(container.textContent).toContain("2 من 2 أمر شراء");

  await act(async () => {
    container.querySelector('[data-testid="open-po-po-1"]').click();
  });
  expect(mockNavigate).toHaveBeenCalledWith("/purchase-orders/po-1");

  await act(async () => {
    const input = container.querySelector('[data-testid="purchase-order-search"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
      .set.call(input, "PO-000002");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelectorAll('[data-testid="purchase-order-row"]')).toHaveLength(1);

  await act(async () => root.unmount());
  container.remove();
});

test("register moves source traceability to details and never fetches legacy Direct Purchases", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PurchaseOrders />);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  expect(mockGet).toHaveBeenCalledWith("/purchase-orders");
  expect(mockGet).not.toHaveBeenCalledWith("/purchases");
  expect(container.textContent).not.toContain("REQ-1");
  expect(container.textContent).not.toContain("CMP-1");
  expect(container.textContent).not.toContain("APR-1");
  expect(container.textContent).not.toContain("المبلغ متاح");

  await act(async () => root.unmount());
  container.remove();
});

test("payment status filter narrows the register by the real PO payment ledger status", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PurchaseOrders />);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  // The register shows the real payment ledger status, without repeating
  // the approval-level "funds released" concept.
  expect(container.textContent).not.toContain("المبلغ متاح");
  expect(container.textContent).toContain("مدفوع بالكامل");
  expect(container.textContent).toContain("لم يحن السداد");

  await act(async () => {
    const select = container.querySelector('[data-testid="purchase-order-payment-filter"]');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")
      .set.call(select, "paid");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelectorAll('[data-testid="purchase-order-row"]')).toHaveLength(1);
  expect(container.textContent).toContain("PO-000002");

  await act(async () => root.unmount());
  container.remove();
});

test("register displays the actual receiving lifecycle status and filters by it", async () => {
  const receivingOrders = [
    ...orders,
    {
      id: "po-3", po_number: "PO-000003", project_name: "مشروع ج",
      supplier_name: "مورد ج", status: "in_delivery", final_total: 300,
      po_date: "2026-08-16", item_count: 1, updated_at: "2026-08-16T12:00:00Z",
      source_request_number: "REQ-3", comparison_number: "CMP-3", approval_number: "APR-3",
      workflow: { expenditure_approved: true, funds_released: false },
      payment_summary: {
        po_total: 300, paid_amount: 0, outstanding_amount: 300,
        payment_status: "not_due", is_overdue: false, due_date: null,
      },
    },
    {
      id: "po-4", po_number: "PO-000004", project_name: "مشروع د",
      supplier_name: "مورد د", status: "completed", final_total: 400,
      po_date: "2026-08-16", item_count: 1, updated_at: "2026-08-16T13:00:00Z",
      source_request_number: "REQ-4", comparison_number: "CMP-4", approval_number: "APR-4",
      workflow: { expenditure_approved: true, funds_released: true },
      payment_summary: {
        po_total: 400, paid_amount: 100, outstanding_amount: 300,
        payment_status: "partially_paid", is_overdue: false, due_date: null,
      },
    },
  ];
  mockGet.mockImplementation(() => Promise.resolve({ data: receivingOrders }));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PurchaseOrders />);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  // Fully received (po-4) is still only "partially_paid" - receiving and
  // payment stay visually and logically separate.
  expect(container.textContent).toContain("قيد التوريد");
  expect(container.textContent).toContain("اكتمل الاستلام");
  expect(container.textContent).toContain("مدفوع جزئيًا");

  await act(async () => {
    const select = container.querySelector('[data-testid="purchase-order-receiving-filter"]');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")
      .set.call(select, "fully_received");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelectorAll('[data-testid="purchase-order-row"]')).toHaveLength(1);
  expect(container.textContent).toContain("PO-000004");

  await act(async () => root.unmount());
  container.remove();
});
