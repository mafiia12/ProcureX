import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import PurchaseOrderDetails from "@/pages/PurchaseOrderDetails";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockNavigate = jest.fn();
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockSearchParams = jest.fn(() => [new URLSearchParams(), jest.fn()]);

jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ purchaseOrderId: "po-1" }),
  useSearchParams: (...args) => mockSearchParams(...args),
  Link: ({ children, to, ...props }) => <a href={typeof to === "string" ? to : "#"} {...props}>{children}</a>,
}), { virtual: true });
jest.mock("@/lib/api", () => ({
  __esModule: true,
  fmtEGP: (value) => `${Number(value || 0).toFixed(2)} ج.م`,
  errMsg: () => "خطأ",
  default: {
    get: (...args) => mockGet(...args), post: (...args) => mockPost(...args),
    patch: (...args) => mockPatch(...args),
  },
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
const mockUseAuth = jest.fn();
jest.mock("@/contexts/AuthContext", () => ({ useAuth: (...a) => mockUseAuth(...a) }));

const order = {
  id: "po-1", po_number: "PO-000001", status: "draft", project_name: "مشروع أ",
  customer_name: "عميل أ", supplier_name: "مورد أ", po_date: "2026-08-17",
  payment_terms: "نقدي", delivery_days: 4, subtotal: 100, discount_total: 0,
  vat_total: 14, shipping_total: 5, other_total: 0, final_total: 119, notes: "راجع الكمية",
  workflow: { expenditure_approved: true, funds_released: true },
  source_trace: [
    { type: "request", id: "req-1", number: "REQ-1" },
    { type: "comparison", id: "cmp-1", number: "CMP-1" },
    { type: "approval", id: "apr-1", number: "APR-1" },
    { type: "purchase_order", id: "po-1", number: "PO-000001" },
  ],
  items: [{
    id: "poi-1", product_name: "أسمنت", item_code: "ITM-1", specifications: "رتبة 42.5",
    quantity: 10, unit: "شيكارة", unit_price: 10, discount_pct: 0, vat_pct: 14,
    shipping_cost: 5, other_cost: 0, delivery_days: 4, line_total: 119,
  }],
};

const emptyLedger = {
  payment_summary: {
    po_total: 119, paid_amount: 0, outstanding_amount: 119,
    payment_status: "not_due", is_overdue: false, due_date: null,
    credit_days: null, payment_terms: "",
  },
  payments: [],
};

let ledgerFixture;

beforeEach(() => {
  ledgerFixture = emptyLedger;
  mockGet.mockImplementation((path) => Promise.resolve({
    data: path.endsWith("/payments") ? ledgerFixture : order,
  }));
  mockPost.mockImplementation((path) => {
    if (path.endsWith("/payments")) {
      return Promise.resolve({ data: { ok: true, already_recorded: false, payment: {}, payment_summary: ledgerFixture.payment_summary } });
    }
    if (path.includes("/payments/") && path.endsWith("/void")) {
      return Promise.resolve({ data: { ok: true, already_recorded: false } });
    }
    return Promise.resolve({ data: { purchase_order: { ...order, status: "in_delivery" } } });
  });
  mockPatch.mockResolvedValue({ data: { ...order, status: "approved" } });
  mockNavigate.mockClear();
  mockSearchParams.mockReturnValue([new URLSearchParams(), jest.fn()]);
  toast.error.mockClear();
  mockUseAuth.mockReturnValue({ user: { username: "admin1", role: "admin", account_type: "erp" } });
});

async function click(element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

test("reviews the complete PO and lets the procurement officer execute it", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PurchaseOrderDetails />);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  expect(mockGet).toHaveBeenCalledWith("/purchase-orders/po-1");
  expect(container.querySelectorAll('[data-testid="po-detail-item"]')).toHaveLength(1);
  expect(container.textContent).toContain("REQ-1");
  expect(container.textContent).toContain("CMP-1");
  expect(container.textContent).toContain("APR-1");
  expect(container.textContent).toContain("🟢 متاح");

  const execute = [...container.querySelectorAll('[data-testid="po-finalize-button"]')][0];
  await click(execute);
  expect(document.querySelector('[data-testid="po-action-confirm-dialog"]')).not.toBeNull();
  expect(mockPost).not.toHaveBeenCalled();

  await click(document.querySelector('[data-testid="po-action-confirm-button"]'));
  expect(mockPost).toHaveBeenCalledWith("/purchase-orders/po-1/finalize", {
    actor: "", note: "",
  });
  expect(container.textContent).toContain("قيد التوريد");
  expect(container.textContent).toContain("تقرير الإدارة بالأسعار");
  expect(container.textContent).toContain("إشعار الموقع بدون أسعار");

  await act(async () => root.unmount());
  container.remove();
});

test("hides the finalize action from a commercial manager", async () => {
  mockUseAuth.mockReturnValue({ user: { username: "manager1", role: "commercial_manager", account_type: "erp" } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PurchaseOrderDetails />);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  expect(container.querySelector('[data-testid="po-finalize-button"]')).toBeNull();
  expect(container.querySelector('[data-testid="po-advance-status-button"]')).toBeNull();
  expect(container.querySelector('[data-testid="po-cancel-button"]')).toBeNull();
  expect(container.textContent).toContain("الإجراء متاح لمسؤول المشتريات فقط");

  await act(async () => root.unmount());
  container.remove();
});

test("lets a supplier-confirmed order enter delivery", async () => {
  mockGet.mockResolvedValue({ data: { ...order, status: "supplier_confirmed" } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PurchaseOrderDetails />);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  expect(container.textContent).toContain("تأكيد المورد");
  // supplier_confirmed has no further PATCH-status step - only finalize.
  expect(container.querySelector('[data-testid="po-advance-status-button"]')).toBeNull();
  const execute = container.querySelector('[data-testid="po-finalize-button"]');
  expect(execute).toBeDefined();
  await click(execute);
  await click(document.querySelector('[data-testid="po-action-confirm-button"]'));
  expect(mockPost).toHaveBeenCalledWith("/purchase-orders/po-1/finalize", {
    actor: "", note: "",
  });
  expect(container.textContent).toContain("قيد التوريد");

  await act(async () => root.unmount());
  container.remove();
});

test("draft PO exposes the next PATCH-status step and requires confirmation to cancel", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PurchaseOrderDetails />);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  const advance = container.querySelector('[data-testid="po-advance-status-button"]');
  expect(advance.textContent).toContain("اعتماد أمر الشراء");
  await click(advance);
  await click(document.querySelector('[data-testid="po-action-confirm-button"]'));
  expect(mockPatch).toHaveBeenCalledWith("/purchase-orders/po-1/status", { status: "approved" });

  const cancel = container.querySelector('[data-testid="po-cancel-button"]');
  await click(cancel);
  expect(document.querySelector('[data-testid="po-action-confirm-dialog"]')).not.toBeNull();
  await click(document.querySelector('[data-testid="po-action-confirm-button"]'));
  expect(mockPatch).toHaveBeenCalledWith("/purchase-orders/po-1/status", { status: "cancelled" });

  await act(async () => root.unmount());
  container.remove();
});

test("a completed PO shows no operational action buttons", async () => {
  mockGet.mockResolvedValue({ data: {
    ...order, status: "completed",
    receipt_summary: { ordered_quantity: 10, received_quantity: 10, remaining_quantity: 0 },
    items: order.items.map((item) => ({ ...item, received_quantity: 10, remaining_quantity: 0 })),
    receipt_history: [],
  } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PurchaseOrderDetails />);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  expect(container.querySelector('[data-testid="po-operational-actions"]')).toBeNull();
  expect(container.querySelector('[data-testid="po-finalize-button"]')).toBeNull();
  expect(container.querySelector('[data-testid="po-cancel-button"]')).toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("shows partial and problem receiving only during delivery and hides actions after completion", async () => {
  const deliveryOrder = {
    ...order, status: "in_delivery",
    receipt_summary: { ordered_quantity: 10, received_quantity: 0, remaining_quantity: 10 },
    receipt_history: [],
    items: order.items.map((item) => ({ ...item, received_quantity: 0, remaining_quantity: 10 })),
  };
  const completedOrder = {
    ...deliveryOrder, status: "completed",
    receipt_summary: { ordered_quantity: 10, received_quantity: 10, remaining_quantity: 0 },
    items: deliveryOrder.items.map((item) => ({ ...item, received_quantity: 10, remaining_quantity: 0 })),
    receipt_history: [{ id: "receipt-1", receipt_type: "full", received_at: "2026-08-17T10:00:00Z", lines: [] }],
  };
  mockGet.mockResolvedValue({ data: deliveryOrder });
  mockPost.mockResolvedValue({ data: { purchase_order: completedOrder } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<PurchaseOrderDetails />); await new Promise((resolve) => setTimeout(resolve, 50)); });
  expect(container.querySelector('[data-testid="site-receiving-section"]')).not.toBeNull();
  expect(container.textContent).toContain("إجمالي المستلم");
  await act(async () => container.querySelector('[data-testid="receive-partial"]').click());
  expect(container.querySelector('[data-testid="partial-receipt-form"]')).not.toBeNull();
  expect(container.textContent).toContain("سابقًا");
  await act(async () => container.querySelector('[data-testid="receive-problem"]').click());
  expect(container.querySelector('[data-testid="problem-receipt-form"]')).not.toBeNull();
  expect(container.textContent).toContain("مواصفة غير مطابقة");
  await click(container.querySelector('[data-testid="receive-full"]'));
  const confirmDialog = document.querySelector('[data-testid="po-action-confirm-dialog"]');
  expect(confirmDialog).not.toBeNull();
  expect(confirmDialog.textContent).toContain("سيتم استلام جميع الكميات المتبقية");
  expect(mockPost).not.toHaveBeenCalledWith("/purchase-orders/po-1/receipts", expect.anything());

  await click(document.querySelector('[data-testid="po-action-confirm-button"]'));
  expect(mockPost).toHaveBeenCalledWith("/purchase-orders/po-1/receipts", expect.objectContaining({
    receipt_type: "full",
  }));
  expect(container.textContent).toContain("لا توجد إجراءات تشغيلية متبقية");
  expect(container.querySelector('[data-testid="receive-full"]')).toBeNull();
  expect(container.querySelector('[data-testid="receipt-history"]')).not.toBeNull();
  await act(async () => root.unmount());
  container.remove();
});

// ---------------- Sprint 3.5: Receiving & PO Lifecycle Finalization ----------------

function deliveryOrderFixture(overrides = {}) {
  return {
    ...order, status: "in_delivery",
    receipt_summary: {
      ordered_quantity: 10, received_quantity: 0, remaining_quantity: 10,
      receipt_count: 0, latest_receipt_date: null,
    },
    receipt_history: [],
    items: order.items.map((item) => ({ ...item, received_quantity: 0, remaining_quantity: 10 })),
    ...overrides,
  };
}

test("receiving summary shows receipt count and latest receipt date", async () => {
  mockGet.mockResolvedValue({ data: deliveryOrderFixture({
    receipt_summary: {
      ordered_quantity: 10, received_quantity: 4, remaining_quantity: 6,
      receipt_count: 2, latest_receipt_date: "2026-08-20T09:00:00Z",
    },
  }) });
  const { container, root } = await renderDetails();

  const section = container.querySelector('[data-testid="site-receiving-section"]');
  expect(section.textContent).toContain("عدد عمليات الاستلام");
  expect(section.textContent).toContain("2");
  expect(section.textContent).toContain("آخر استلام");

  await act(async () => root.unmount());
  container.remove();
});

test("procurement_responsible sees receiving mutation actions", async () => {
  mockUseAuth.mockReturnValue({ user: { username: "resp1", role: "procurement_responsible", account_type: "erp" } });
  mockGet.mockResolvedValue({ data: deliveryOrderFixture() });
  const { container, root } = await renderDetails();

  expect(container.querySelector('[data-testid="receive-full"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="receive-partial"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="receive-problem"]')).not.toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("procurement_engineer is read-only for receiving", async () => {
  mockUseAuth.mockReturnValue({ user: { username: "eng1", role: "procurement_engineer", account_type: "erp" } });
  mockGet.mockResolvedValue({ data: deliveryOrderFixture() });
  const { container, root } = await renderDetails();

  expect(container.querySelector('[data-testid="receive-full"]')).toBeNull();
  expect(container.querySelector('[data-testid="receive-partial"]')).toBeNull();
  expect(container.querySelector('[data-testid="receive-problem"]')).toBeNull();
  expect(container.textContent).toContain("تأكيد الاستلام متاح لمسؤول المشتريات");

  await act(async () => root.unmount());
  container.remove();
});

test("commercial_manager is read-only for receiving", async () => {
  mockUseAuth.mockReturnValue({ user: { username: "mgr1", role: "commercial_manager", account_type: "erp" } });
  mockGet.mockResolvedValue({ data: deliveryOrderFixture() });
  const { container, root } = await renderDetails();

  expect(container.querySelector('[data-testid="receive-full"]')).toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("client blocks a partial receipt quantity greater than remaining", async () => {
  mockGet.mockResolvedValue({ data: deliveryOrderFixture() });
  const { container, root } = await renderDetails();

  await click(container.querySelector('[data-testid="receive-partial"]'));
  const quantityInput = document.querySelector('[data-testid="partial-receipt-form"] input[type="number"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(quantityInput, "50");
    quantityInput.dispatchEvent(new Event("input", { bubbles: true }));
  });

  expect(document.querySelector('[data-testid="partial-receipt-quantity-error"]')).not.toBeNull();
  const submitButton = [...document.querySelectorAll('[data-testid="partial-receipt-form"] button')]
    .find((button) => button.textContent.includes("حفظ الاستلام الجزئي"));
  expect(submitButton.disabled).toBe(true);

  await act(async () => { submitButton.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
  expect(mockPost).not.toHaveBeenCalledWith("/purchase-orders/po-1/receipts", expect.anything());

  await act(async () => root.unmount());
  container.remove();
});

test("a cancelled PO hides receiving mutation buttons but keeps history readable", async () => {
  mockGet.mockResolvedValue({ data: {
    ...order, status: "cancelled",
    receipt_history: [{ id: "receipt-1", receipt_type: "partial", received_at: "2026-08-17T10:00:00Z", lines: [] }],
  } });
  const { container, root } = await renderDetails();

  expect(container.querySelector('[data-testid="site-receiving-section"]')).toBeNull();
  expect(container.querySelector('[data-testid="receipt-history"]')).not.toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

// ---------------- Sprint 3.4: PO Payment Ledger ----------------

async function renderDetails() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PurchaseOrderDetails />);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  return { container, root };
}

test("PO detail shows total/paid/outstanding and payment history", async () => {
  ledgerFixture = {
    payment_summary: {
      po_total: 119, paid_amount: 50, outstanding_amount: 69,
      payment_status: "partially_paid", is_overdue: false, due_date: "2026-09-20",
      credit_days: 30, payment_terms: "نقدي",
    },
    payments: [{
      id: "pay-1", payment_number: "PAY-000001", payment_date: "2026-08-25",
      amount: 50, payment_method: "bank_transfer", payment_reference: "TX-1",
      notes: "", status: "recorded", void_reason: "", created_by: "manager1",
    }],
  };
  const { container, root } = await renderDetails();

  const summary = container.querySelector('[data-testid="po-payment-summary"]');
  expect(summary.textContent).toContain("119.00 ج.م");
  expect(summary.textContent).toContain("50.00 ج.م");
  expect(summary.textContent).toContain("69.00 ج.م");
  expect(container.querySelectorAll('[data-testid="po-payment-row"]')).toHaveLength(1);
  expect(summary.textContent).toContain("PAY-000001");
  expect(summary.textContent).toContain("TX-1");

  await act(async () => root.unmount());
  container.remove();
});

test("commercial_manager sees the Record Payment action", async () => {
  mockUseAuth.mockReturnValue({ user: { username: "mgr1", role: "commercial_manager", account_type: "erp" } });
  const { container, root } = await renderDetails();

  expect(container.querySelector('[data-testid="po-record-payment-button"]')).not.toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("admin sees the Record Payment action", async () => {
  const { container, root } = await renderDetails();

  expect(container.querySelector('[data-testid="po-record-payment-button"]')).not.toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("procurement_responsible does not see payment mutation actions", async () => {
  mockUseAuth.mockReturnValue({ user: { username: "resp1", role: "procurement_responsible", account_type: "erp" } });
  ledgerFixture = {
    payment_summary: {
      po_total: 119, paid_amount: 50, outstanding_amount: 69,
      payment_status: "partially_paid", is_overdue: false, due_date: null,
      credit_days: null, payment_terms: "",
    },
    payments: [{
      id: "pay-1", payment_number: "PAY-000001", payment_date: "2026-08-25",
      amount: 50, payment_method: "cash", payment_reference: "", notes: "",
      status: "recorded", void_reason: "", created_by: "manager1",
    }],
  };
  const { container, root } = await renderDetails();

  expect(container.querySelector('[data-testid="po-record-payment-button"]')).toBeNull();
  expect(container.querySelector('[data-testid="po-void-button-pay-1"]')).toBeNull();
  // Still visible - read-only.
  expect(container.querySelector('[data-testid="po-payment-summary"]')).not.toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("procurement_engineer does not see payment mutation actions", async () => {
  mockUseAuth.mockReturnValue({ user: { username: "eng1", role: "procurement_engineer", account_type: "erp" } });
  const { container, root } = await renderDetails();

  expect(container.querySelector('[data-testid="po-record-payment-button"]')).toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("Record Payment opens a form pre-filled with PO and outstanding context", async () => {
  const { container, root } = await renderDetails();

  await click(container.querySelector('[data-testid="po-record-payment-button"]'));

  const dialog = document.querySelector('[data-testid="po-record-payment-dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog.textContent).toContain("PO-000001");
  expect(dialog.textContent).toContain("مورد أ");
  expect(document.querySelector('[data-testid="po-payment-amount-input"]')).not.toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("amount greater than outstanding is blocked client-side", async () => {
  const { container, root } = await renderDetails();
  await click(container.querySelector('[data-testid="po-record-payment-button"]'));

  const amountInput = document.querySelector('[data-testid="po-payment-amount-input"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(amountInput, "500");
    amountInput.dispatchEvent(new Event("input", { bubbles: true }));
  });

  expect(document.querySelector('[data-testid="po-payment-amount-error"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="po-payment-submit-button"]').disabled).toBe(true);

  await act(async () => {
    document.querySelector('[data-testid="po-payment-submit-button"]').click();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(mockPost).not.toHaveBeenCalledWith("/purchase-orders/po-1/payments", expect.anything());

  await act(async () => root.unmount());
  container.remove();
});

test("Pay Full Outstanding only fills the amount and still requires confirmation", async () => {
  const { container, root } = await renderDetails();
  await click(container.querySelector('[data-testid="po-record-payment-button"]'));

  await click(document.querySelector('[data-testid="po-payment-full-outstanding-button"]'));
  expect(document.querySelector('[data-testid="po-payment-amount-input"]').value).toBe("119.00");
  expect(mockPost).not.toHaveBeenCalledWith("/purchase-orders/po-1/payments", expect.anything());
  expect(document.querySelector('[data-testid="po-payment-submit-button"]').disabled).toBe(false);

  await act(async () => root.unmount());
  container.remove();
});

test("a valid amount submits and a backend rejection is still handled gracefully", async () => {
  mockPost.mockImplementation((path) => {
    if (path.endsWith("/payments")) return Promise.reject({ response: { data: { detail: "خطأ" }, status: 422 } });
    return Promise.resolve({ data: { purchase_order: order } });
  });
  const { container, root } = await renderDetails();
  await click(container.querySelector('[data-testid="po-record-payment-button"]'));

  const amountInput = document.querySelector('[data-testid="po-payment-amount-input"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(amountInput, "50");
    amountInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.querySelector('[data-testid="po-payment-submit-button"]').disabled).toBe(false);

  await click(document.querySelector('[data-testid="po-payment-submit-button"]'));
  expect(mockPost).toHaveBeenCalledWith("/purchase-orders/po-1/payments", expect.objectContaining({ amount: 50 }));
  // Dialog stays open (not silently closed) and the app does not crash.
  expect(document.querySelector('[data-testid="po-record-payment-dialog"]')).not.toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("void requires a reason before it can be confirmed", async () => {
  ledgerFixture = {
    payment_summary: {
      po_total: 119, paid_amount: 50, outstanding_amount: 69,
      payment_status: "partially_paid", is_overdue: false, due_date: null,
      credit_days: null, payment_terms: "",
    },
    payments: [{
      id: "pay-1", payment_number: "PAY-000001", payment_date: "2026-08-25",
      amount: 50, payment_method: "cash", payment_reference: "REF-1", notes: "",
      status: "recorded", void_reason: "", created_by: "manager1",
    }],
  };
  const { container, root } = await renderDetails();

  await click(container.querySelector('[data-testid="po-void-button-pay-1"]'));
  const dialog = document.querySelector('[data-testid="po-void-payment-dialog"]');
  expect(dialog.textContent).toContain("PAY-000001");
  expect(document.querySelector('[data-testid="po-void-confirm-button"]').disabled).toBe(true);

  const reasonInput = document.querySelector('[data-testid="po-void-reason-input"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(reasonInput, "دفعة مكررة");
    reasonInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.querySelector('[data-testid="po-void-confirm-button"]').disabled).toBe(false);

  await click(document.querySelector('[data-testid="po-void-confirm-button"]'));
  expect(mockPost).toHaveBeenCalledWith(
    "/purchase-orders/po-1/payments/pay-1/void", { reason: "دفعة مكررة" },
  );

  await act(async () => root.unmount());
  container.remove();
});

test("paid status renders", async () => {
  ledgerFixture = {
    payment_summary: {
      po_total: 119, paid_amount: 119, outstanding_amount: 0,
      payment_status: "paid", is_overdue: false, due_date: null,
      credit_days: null, payment_terms: "",
    },
    payments: [],
  };
  const { container, root } = await renderDetails();

  expect(container.querySelector('[data-testid="po-payment-summary"]').textContent).toContain("مدفوع بالكامل");

  await act(async () => root.unmount());
  container.remove();
});

// ---------------- Dashboard follow-up deep links ----------------

test("?section=payments opens the PO directly on the payments tab", async () => {
  mockSearchParams.mockReturnValue([new URLSearchParams("section=payments"), jest.fn()]);
  const { container, root } = await renderDetails();

  const paymentsPanel = container.querySelector('[data-testid="po-payment-summary"]');
  expect(paymentsPanel.closest('[data-state="active"]')).not.toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("?section=receiving opens the PO directly on the receiving tab", async () => {
  mockSearchParams.mockReturnValue([new URLSearchParams("section=receiving"), jest.fn()]);
  mockGet.mockImplementation((path) => Promise.resolve({
    data: path.endsWith("/payments") ? ledgerFixture : deliveryOrderFixture(),
  }));
  const { container, root } = await renderDetails();

  const receivingSection = container.querySelector('[data-testid="site-receiving-section"]');
  expect(receivingSection.closest('[data-state="active"]')).not.toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("an unknown/deleted PO id from a follow-up link falls back to the register with a toast, no crash", async () => {
  mockGet.mockImplementation(() => Promise.reject({ response: { status: 404 } }));
  const { root } = await renderDetails();

  expect(mockNavigate).toHaveBeenCalledWith("/purchase-orders", { replace: true });
  expect(toast.error).toHaveBeenCalled();

  await act(async () => root.unmount());
});

test("overdue status renders", async () => {
  ledgerFixture = {
    payment_summary: {
      po_total: 119, paid_amount: 0, outstanding_amount: 119,
      payment_status: "due", is_overdue: true, due_date: "2020-01-01",
      credit_days: null, payment_terms: "",
    },
    payments: [],
  };
  const { container, root } = await renderDetails();

  expect(container.querySelector('[data-testid="po-payment-summary"]').textContent).toContain("متأخر");

  await act(async () => root.unmount());
  container.remove();
});
