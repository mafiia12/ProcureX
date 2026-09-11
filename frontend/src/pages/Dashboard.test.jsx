import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Dashboard from "@/pages/Dashboard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGet = jest.fn();
const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }), { virtual: true });
jest.mock("@/lib/api", () => ({
  __esModule: true,
  fmtEGP: (value) => `${value || 0} ج.م`,
  default: { get: (...args) => mockGet(...args) },
}));
const dashboard = {
  summary: {
    requests_requiring_action: 2, active_purchase_orders: 3,
    formal_po_value: 900, actual_paid: 300, outstanding: 600,
  },
  request_pipeline: [
    { key: "technical_review", label: "مراجعة فنية", count: 2 },
    { key: "pricing_rfq", label: "تسعير / طلبات عروض أسعار", count: 1 },
    { key: "under_delivery", label: "تحت التوريد", count: 2 },
  ],
  approval_attention: { stages: [{ key: "technical", count: 1 }] },
  receiving: {
    in_delivery_count: 1, partial_received_count: 1,
    delivery_problem_count: 1, completed_count: 1,
    attention: [{ po_number: "PO-000010", supplier_name: "مورد ب" }],
  },
  project_procurement_summary: [{ project_name: "مشروع أ", formal_po_value: 900, actual_paid: 300, outstanding: 600 }],
  attention_items: [
    { type: "delivery_problem", reference: "PO-000010", project_name: "مشروع ب", reason: "مشكلة في التوريد", path: "/purchase-orders/po-problem-1" },
    { type: "needs_clarification", reference: "REQ-000004", project_name: "مشروع أ", reason: "بانتظار استكمال التوضيح المطلوب", path: "/incoming-requests" },
  ],
  payment_intelligence: { attention: [] },
  direct_purchase_total: 250, direct_purchase_count: 2,
  direct_paid_total: 100, direct_outstanding_total: 150,
};

async function renderDashboard(data = dashboard) {
  mockGet.mockResolvedValue({ data });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Dashboard />);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  return { container, root };
}

afterEach(() => mockNavigate.mockClear());

test("renders only the five highest-value operational KPIs", async () => {
  const { container, root } = await renderDashboard();
  expect(mockGet).toHaveBeenCalledWith("/dashboard");
  const section = container.querySelector('[data-testid="formal-procurement-kpis"]');
  expect(section.querySelectorAll("article")).toHaveLength(5);
  expect(section.textContent).toContain("يحتاج إجراء2");
  expect(section.textContent).toContain("قرارات اعتماد معلقة1");
  expect(section.textContent).toContain("مشكلات التوريد والاستلام2");
  expect(section.textContent).toContain("600 ج.م");
  expect(section.textContent).not.toContain("900 ج.م");
  expect(section.textContent).not.toContain("300 ج.م");
  expect(section.textContent).not.toContain("250 ج.م");
  await act(async () => root.unmount());
  container.remove();
});

test("centers actual actionable records with one direct action", async () => {
  const { container, root } = await renderDashboard();
  const center = container.querySelector('[data-testid="attention-center"]');
  expect(center.textContent).toContain("PO-000010");
  expect(center.textContent).toContain("REQ-000004");
  expect(center.textContent).toContain("يحتاج توضيح");
  await act(async () => {
    center.querySelector('[data-testid="attention-item-delivery_problem"] button').click();
  });
  expect(mockNavigate).toHaveBeenCalledWith("/purchase-orders/po-problem-1");
  await act(async () => root.unmount());
  container.remove();
});

test("clicking anywhere on the row opens the exact record, not just the button", async () => {
  const { container, root } = await renderDashboard({
    ...dashboard,
    attention_items: [
      { type: "delivery_problem", reference: "PO-000010", project_name: "مشروع ب", reason: "مشكلة في التوريد", path: "/purchase-orders/po-problem-1", purchase_order_id: "po-problem-1" },
    ],
  });
  const row = container.querySelector('[data-testid="attention-item-delivery_problem"]');
  await act(async () => { row.click(); });
  expect(mockNavigate).toHaveBeenCalledWith("/purchase-orders/po-problem-1?section=receiving");
  await act(async () => root.unmount());
  container.remove();
});

test("Enter/Space keyboard activation opens the exact record", async () => {
  const { container, root } = await renderDashboard({
    ...dashboard,
    attention_items: [
      { type: "pending_approval", reference: "APR-1", project_name: "مشروع ب", reason: "اعتماد معلق", path: "/approvals", approval_id: "approval-1" },
    ],
  });
  const row = container.querySelector('[data-testid="attention-item-pending_approval"]');
  await act(async () => {
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  expect(mockNavigate).toHaveBeenCalledWith("/approvals", { state: { approval_id: "approval-1" } });
  await act(async () => {
    row.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
  });
  expect(mockNavigate).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
  container.remove();
});

test("RFQ/sourcing/PO/payment/receiving follow-ups deep-link into the exact record and stage", async () => {
  const { container, root } = await renderDashboard({
    ...dashboard,
    attention_items: [
      { type: "overdue_payment", reference: "PO-2", project_name: "م", reason: "متأخر", path: "/purchase-orders/po-2", purchase_order_id: "po-2" },
      { type: "partial_received", reference: "PO-3", project_name: "م", reason: "جزئي", path: "/purchase-orders/po-3", purchase_order_id: "po-3" },
      { type: "rfq_past_deadline", reference: "RFQ-1", project_name: "م", reason: "متأخر", path: "/rfq/rfq-1", rfq_id: "rfq-1" },
      { type: "sourcing_required", reference: "REQ-9", project_name: "م", reason: "جاهز", path: "/incoming-requests", request_id: "req-9" },
    ],
  });
  const clickRow = async (type) => {
    await act(async () => { container.querySelector(`[data-testid="attention-item-${type}"]`).click(); });
  };
  await clickRow("overdue_payment");
  expect(mockNavigate).toHaveBeenCalledWith("/purchase-orders/po-2?section=payments");
  await clickRow("partial_received");
  expect(mockNavigate).toHaveBeenCalledWith("/purchase-orders/po-3?section=receiving");
  await clickRow("rfq_past_deadline");
  expect(mockNavigate).toHaveBeenCalledWith("/rfq/rfq-1");
  await clickRow("sourcing_required");
  expect(mockNavigate).toHaveBeenCalledWith("/incoming-requests", { state: { request_id: "req-9" } });
  await act(async () => root.unmount());
  container.remove();
});

test("a follow-up item with no usable target shows a fallback toast instead of navigating or crashing", async () => {
  const { container, root } = await renderDashboard({
    ...dashboard,
    attention_items: [
      { type: "some_future_type", reference: "X-1", project_name: "م", reason: "غير معروف" },
    ],
  });
  const row = container.querySelector('[data-testid="attention-item-some_future_type"]');
  expect(row).not.toBeNull();
  await act(async () => { row.click(); });
  expect(mockNavigate).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  container.remove();
});

test("keeps the daily report compact and removes non-actionable document artifacts", async () => {
  const { container, root } = await renderDashboard({
    ...dashboard,
    attention_items: [
      ...dashboard.attention_items,
      { type: "purchase_draft", reference: "PDR-000001", path: "/incoming-requests" },
      { type: "internal_request", reference: "IPR-000001", path: "/incoming-requests" },
    ],
  });
  const header = container.querySelector('[data-testid="dashboard-command-header"]');
  const dailyReport = [...header.querySelectorAll("button")]
    .find((button) => button.textContent.includes("التقرير اليومي"));
  expect(dailyReport).toBeTruthy();
  expect(dailyReport.classList.contains("h-7")).toBe(true);
  expect(container.textContent).not.toContain("PDR-000001");
  expect(container.textContent).not.toContain("IPR-000001");
  expect(container.querySelector('[data-testid="kpi-action-required"]').textContent).toContain("2");
  await act(async () => dailyReport.click());
  expect(mockNavigate).toHaveBeenCalledWith("/daily-report");
  await act(async () => root.unmount());
  container.remove();
});

test("renders a pricing-ready request as sourcing work for Procurement Responsible", async () => {
  const { container, root } = await renderDashboard({
    ...dashboard,
    attention_items: [{
      type: "sourcing_required", reference: "REQ-READY", project_name: "مشروع أ",
      reason: "أصناف معتمدة جاهزة لإنشاء طلب تسعير ومقارنة", path: "/incoming-requests",
      responsible_role: "procurement_responsible",
    }],
  });
  const row = container.querySelector('[data-testid="attention-item-sourcing_required"]');
  expect(row).not.toBeNull();
  expect(row.textContent).toContain("بدء التسعير");
  await act(async () => row.querySelector("button").click());
  expect(mockNavigate).toHaveBeenCalledWith("/incoming-requests");
  await act(async () => root.unmount());
});

test("keeps one useful project chart and compact workflow health", async () => {
  const { container, root } = await renderDashboard();
  const exposure = container.querySelector('[data-testid="chart-project-value"]');
  expect(exposure).toBeTruthy();
  expect(exposure.textContent).toContain("900 ج.م");
  expect(exposure.textContent).toContain("300 ج.م");
  expect(exposure.textContent).toContain("600 ج.م");
  expect(container.querySelector('[data-testid="request-pipeline"]').textContent).toContain("تحت التوريد");
  expect(container.querySelector('[data-testid="po-status-section"]').textContent).toContain("استلام جزئي");
  expect(container.querySelectorAll('[data-testid^="delivery-health-"]')).toHaveLength(4);
  const snapshot = container.querySelector('[data-testid="dashboard-operational-snapshot"]');
  expect(snapshot.querySelector('[data-testid="request-pipeline"]')).toBeTruthy();
  expect(snapshot.querySelector('[data-testid="chart-project-value"]')).toBeTruthy();
  expect(snapshot.querySelector('[data-testid="po-status-section"]')).toBeTruthy();
  await act(async () => root.unmount());
  container.remove();
});

test("renders empty formal states safely", async () => {
  const { container, root } = await renderDashboard({
    ...dashboard,
    summary: {}, request_pipeline: [], approval_attention: { stages: [] },
    receiving: {}, project_procurement_summary: [], attention_items: [],
  });
  expect(container.querySelector('[data-testid="dashboard-page"]')).toBeTruthy();
  expect(container.textContent).toContain("لا توجد إجراءات عاجلة");
  expect(container.textContent).not.toContain("NaN");
  await act(async () => root.unmount());
  container.remove();
});

test("never renders the legacy direct-purchase KPI summary, even collapsed", async () => {
  const { container, root } = await renderDashboard();
  expect(container.querySelector('[data-testid="legacy-direct-purchases"]')).toBeFalsy();
  expect(container.querySelector('[data-testid="legacy-direct-purchases-toggle"]')).toBeFalsy();
  expect(container.querySelector('[data-testid="kpi-total-purchases"]')).toBeFalsy();
  expect(container.textContent).not.toContain("بيانات الشراء المباشر القديمة");
  expect(container.textContent).not.toContain("250 ج.م");
  await act(async () => root.unmount());
  container.remove();
});
