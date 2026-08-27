import React, { act } from "react";
import { createRoot } from "react-dom/client";
import DailyProcurementReport from "@/pages/DailyProcurementReport";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGet = jest.fn();
const mockPut = jest.fn();
const mockPost = jest.fn();
const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }), { virtual: true });
jest.mock("@/lib/api", () => ({
  __esModule: true,
  fmtEGP: (value) => `${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`,
  errMsg: () => "خطأ",
  default: {
    get: (...args) => mockGet(...args),
    put: (...args) => mockPut(...args),
    post: (...args) => mockPost(...args),
  },
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
const mockUseAuth = jest.fn();
jest.mock("@/contexts/AuthContext", () => ({ useAuth: (...a) => mockUseAuth(...a) }));

const TODAY = new Date().toISOString().slice(0, 10);

const baseReport = {
  report_date: TODAY,
  report_number: `DPR-${TODAY}`,
  generated_at: `${TODAY}T09:00:00Z`,
  is_closed: false,
  closed_at: "",
  closed_by: "",
  notes: { general_notes: "", key_risks: "", follow_up_notes: "" },
  summary: {
    new_requests_count: 3, rfqs_created_count: 1, comparisons_active_count: 1,
    approvals_completed_count: 2, purchase_orders_issued_count: 1,
    purchase_orders_issued_value: 185450, payments_made_count: 1,
    payments_made_value: 50000, outstanding_supplier_balance: 135450.5,
    receipts_recorded_count: 1,
  },
  summary_frozen: false,
  sections: {
    requests_received: [{
      id: "req-1", request_number: "REQ-000001", project_name: "مشروع أ",
      requester_name: "أحمد", location: "الموقع الرئيسي", created_at: `${TODAY}T08:00:00Z`,
      required_delivery_date: TODAY, item_count: 2,
      item_status_breakdown: { approved: 1, pending: 1 }, priority: "high", status: "pricing",
    }],
    sourcing_activity: [{
      kind: "comparison", reference: "CMP-000001", project_name: "مشروع أ",
      supplier_name: "مورد أ", status: "complete", offer_total: 90000, is_complete: true,
      selected: true, attachment_count: null, activity_at: `${TODAY}T10:00:00Z`,
    }],
    purchase_orders_issued: [{
      id: "po-1", po_number: "PO-000001", project_name: "مشروع أ", supplier_name: "مورد أ",
      source_request_number: "REQ-000001", comparison_number: "CMP-000001", approval_number: "APR-000001",
      item_count: 3, final_total: 185450, paid_amount: 50000, outstanding_amount: 135450,
      payment_status: "partially_paid", status: "sent",
    }],
    supplier_financial_position: [{
      supplier_id: "sup-1", supplier_name: "مورد أ", total_po_value: 185450, paid_amount: 50000,
      outstanding_amount: 135450.5, payment_status: "partially_paid", open_po_count: 1,
      latest_payment_date: TODAY, latest_po_number: "PO-000001",
    }],
    payments_today: [{
      id: "pay-1", payment_number: "POP-000001", supplier_name: "مورد أ", po_number: "PO-000001",
      project_name: "مشروع أ", amount: 50000, payment_method: "bank_transfer",
      payment_reference: "TRX-1", created_by: "محاسب", payment_date: TODAY,
      current_outstanding_amount: 135450, remaining_balance_is_current: true,
    }],
    receiving_activity: [{
      id: "rcpt-1", po_number: "PO-000001", project_name: "مشروع أ", supplier_name: "مورد أ",
      receipt_type: "partial", line_count: 2, received_quantity: 5, actor_name: "مهندس الموقع",
      received_at: `${TODAY}T11:00:00Z`, note: "", problem_reason: "",
    }],
    needs_attention: [{
      type: "overdue_payment", reference: "PO-000001", project_name: "مشروع أ",
      reason: "متأخر السداد", due_or_age: TODAY, path: "/purchase-orders/po-1",
      responsible_role: "commercial_manager",
    }],
  },
};

async function renderReport(user = { username: "pr1", role: "procurement_responsible", account_type: "erp" }, report = baseReport) {
  mockUseAuth.mockReturnValue({ user });
  mockGet.mockResolvedValue({ data: report });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<DailyProcurementReport />);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  return { container, root };
}

afterEach(() => {
  mockGet.mockClear(); mockPut.mockClear(); mockPost.mockClear(); mockNavigate.mockClear();
});

test("defaults to today's date and requests it from the backend", async () => {
  const { container, root } = await renderReport();
  expect(mockGet).toHaveBeenCalledWith("/reports/daily", { params: { date: TODAY } });
  expect(container.querySelector('[data-testid="daily-report-date-input"]').value).toBe(TODAY);
  await act(async () => root.unmount());
  container.remove();
});

test("renders requests received, POs issued and supplier financial position with western digits", async () => {
  const { container, root } = await renderReport();
  expect(container.querySelector('[data-testid="section-requests"]').textContent).toContain("REQ-000001");
  const poSection = container.querySelector('[data-testid="section-pos"]');
  expect(poSection.textContent).toContain("PO-000001");
  expect(poSection.textContent).toContain("185,450.00 ج.م");
  expect(poSection.querySelector("tbody").textContent).not.toMatch(/[٠-٩]/);
  const supplierSection = container.querySelector('[data-testid="section-supplier-position"]');
  expect(supplierSection.textContent).toContain("مورد أ");
  expect(supplierSection.textContent).toContain("مدفوع جزئيًا");
  await act(async () => root.unmount());
  container.remove();
});

test("renders fully paid, partially paid and unpaid supplier statuses distinctly", async () => {
  const { container, root } = await renderReport(undefined, {
    ...baseReport,
    sections: {
      ...baseReport.sections,
      supplier_financial_position: [
        { supplier_id: "s1", supplier_name: "مورد كامل", total_po_value: 1000, paid_amount: 1000, outstanding_amount: 0, payment_status: "paid", open_po_count: 0, latest_payment_date: TODAY, latest_po_number: "PO-1" },
        { supplier_id: "s2", supplier_name: "مورد جزئي", total_po_value: 1000, paid_amount: 400, outstanding_amount: 600, payment_status: "partially_paid", open_po_count: 1, latest_payment_date: TODAY, latest_po_number: "PO-2" },
        { supplier_id: "s3", supplier_name: "مورد غير مدفوع", total_po_value: 1000, paid_amount: 0, outstanding_amount: 1000, payment_status: "unpaid", open_po_count: 1, latest_payment_date: "", latest_po_number: "PO-3" },
      ],
    },
  });
  const text = container.querySelector('[data-testid="section-supplier-position"]').textContent;
  expect(text).toContain("مدفوع بالكامل");
  expect(text).toContain("مدفوع جزئيًا");
  expect(text).toContain("غير مدفوع");
  await act(async () => root.unmount());
  container.remove();
});

test("renders needs-attention records with a jump-to action", async () => {
  const { container, root } = await renderReport();
  const section = container.querySelector('[data-testid="section-attention"]');
  expect(section.textContent).toContain("PO-000001");
  const button = section.querySelector("button");
  await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(mockNavigate).toHaveBeenCalledWith("/purchase-orders/po-1");
  await act(async () => root.unmount());
  container.remove();
});

test("saves daily notes for procurement_responsible", async () => {
  mockPut.mockResolvedValue({ data: { notes: { general_notes: "ملاحظة", key_risks: "", follow_up_notes: "" } } });
  const { container, root } = await renderReport();
  const textarea = container.querySelector('[data-testid="section-notes"] textarea');
  await act(async () => {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    nativeSetter.call(textarea, "ملاحظة");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const saveButton = Array.from(container.querySelectorAll("button")).find((btn) => btn.textContent.includes("حفظ الملاحظات"));
  expect(saveButton.disabled).toBe(false);
  await act(async () => { saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(mockPut).toHaveBeenCalledWith(`/reports/daily/${TODAY}/notes`, { general_notes: "ملاحظة", key_risks: "", follow_up_notes: "" });
  await act(async () => root.unmount());
  container.remove();
});

test("hides notes/close controls for a role without manage access", async () => {
  const { container, root } = await renderReport({ username: "eng1", role: "procurement_engineer", account_type: "erp" });
  const notesSection = container.querySelector('[data-testid="section-notes"]');
  expect(notesSection.querySelector("textarea").disabled).toBe(true);
  expect(Array.from(notesSection.querySelectorAll("button")).find((btn) => btn.textContent.includes("حفظ الملاحظات"))).toBeUndefined();
  await act(async () => root.unmount());
  container.remove();
});

test("locks notes editing and offers reopen once the report is closed", async () => {
  const { container, root } = await renderReport(undefined, {
    ...baseReport, is_closed: true, closed_at: `${TODAY}T18:00:00Z`, closed_by: "مسؤول المشتريات",
    summary_frozen: true,
  });
  expect(container.textContent).toContain("هذا التقرير مغلق");
  expect(container.querySelector('[data-testid="section-notes"] textarea').disabled).toBe(true);
  const reopenButton = Array.from(container.querySelectorAll("button")).find((btn) => btn.textContent.includes("إعادة فتح"));
  expect(reopenButton).toBeTruthy();
  await act(async () => root.unmount());
  container.remove();
});
