import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Payments from "./Payments";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGet = jest.fn();
const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }), { virtual: true });
jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: { get: (...args) => mockGet(...args) },
  fmtEGP: (value) => `${Number(value || 0).toFixed(2)} EGP`,
  errMsg: () => "error",
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));

const orders = [
  { id: "po-1", po_number: "PO-000001", project_name: "مشروع أ", supplier_name: "مورد أ", status: "in_delivery", final_total: 1000, payment_summary: { po_total: 1000, paid_amount: 250, outstanding_amount: 750, payment_status: "partially_paid", last_payment_date: "2026-08-20" } },
  { id: "po-2", po_number: "PO-000002", project_name: "مشروع ب", supplier_name: "مورد ب", status: "completed", final_total: 500, payment_summary: { po_total: 500, paid_amount: 500, outstanding_amount: 0, payment_status: "paid", last_payment_date: "2026-08-19" } },
  { id: "po-3", po_number: "PO-000003", project_name: "مشروع ج", supplier_name: "مورد ج", status: "cancelled", final_total: 900, payment_summary: { po_total: 900, paid_amount: 0, outstanding_amount: 900, payment_status: "not_due" } },
];

async function renderPayments() {
  mockGet.mockResolvedValue({ data: orders });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Payments />);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  return { container, root };
}

beforeEach(() => { mockGet.mockReset(); mockNavigate.mockClear(); });

test("uses only the formal PO ledger and exposes total, paid, and outstanding", async () => {
  const { container, root } = await renderPayments();
  expect(mockGet).toHaveBeenCalledWith("/purchase-orders");
  expect(mockGet).not.toHaveBeenCalledWith("/payments");
  expect(mockGet).not.toHaveBeenCalledWith("/purchases");
  expect(container.querySelector('[data-testid="payments-total-po"]').textContent).toContain("1500.00 EGP");
  expect(container.querySelector('[data-testid="payments-total-paid"]').textContent).toContain("750.00 EGP");
  expect(container.querySelector('[data-testid="payments-total-outstanding"]').textContent).toContain("750.00 EGP");
  expect(container.querySelectorAll('[data-testid="payment-row"]')).toHaveLength(2);
  await act(async () => root.unmount());
  container.remove();
});

test("uses the three business payment states and filters the register", async () => {
  const { container, root } = await renderPayments();
  expect(container.textContent).toContain("مدفوع جزئيًا");
  expect(container.textContent).toContain("مدفوع بالكامل");
  const filter = container.querySelector('[data-testid="payments-status-filter"]');
  await act(async () => {
    filter.value = "paid";
    filter.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelectorAll('[data-testid="payment-row"]')).toHaveLength(1);
  expect(container.textContent).toContain("PO-000002");
  expect(container.textContent).not.toContain("PO-000001");
  await act(async () => root.unmount());
  container.remove();
});

test("opens the existing PO payment ledger rather than a duplicate form", async () => {
  const { container, root } = await renderPayments();
  await act(async () => container.querySelector('[data-testid="open-po-payments-po-1"]').click());
  expect(mockNavigate).toHaveBeenCalledWith("/purchase-orders/po-1");
  expect(container.textContent).not.toContain("حفظ دفعة");
  await act(async () => root.unmount());
  container.remove();
});
