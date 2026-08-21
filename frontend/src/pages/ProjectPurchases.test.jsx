import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ProjectPurchases from "@/pages/ProjectPurchases";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockNavigate = jest.fn();
const mockGet = jest.fn();
const hub = {
  project: { id: "project-1", code: "PRJ-1", name: "مشروع اختبار", customer_name: "عميل", engineer: "مهندس", status: "active" },
  kpis: {
    request_count: 1, under_review: 0, comparison_count: 1, pending_approval: 0,
    purchase_order_count: 1, formal_po_count: 1, formal_po_total: 100,
    formal_under_supply_count: 1, formal_under_supply_value: 100,
    formal_completed_po_count: 0, formal_completed_po_value: 0,
    approval_pending_total: 20, approval_paid_total: 80,
    direct_purchase_count: 1, direct_purchase_total: 75,
    direct_paid_total: 50, direct_outstanding_total: 25,
    actions: { technical_review: 0, ready_for_comparison: 1, under_supply: 1 },
    action_priorities: [
      { key: "ready_for_comparison", count: 1 },
      { key: "under_supply", count: 1 },
    ],
  },
  requests: [{ id: "request-1", request_number: "REQ-1", requester_name: "موقع", project_name: "مشروع اختبار", status: "pricing" }],
  comparisons: [{ id: "comparison-1", comparison_number: "CMP-1", comparison_date: "2026-08-16", customer_name: "عميل" }],
  approvals: [{ id: "approval-1", approval_number: "APR-1", revision_number: 0, status: "approved", approval_stage: "fund_release", final_total: 100 }],
  purchase_orders: [{ id: "po-1", po_number: "PO-1", supplier_name: "مورد", status: "approved", final_total: 100 }],
  purchases: [{ id: "row-1", purchase_id: "PUR-000001", supplier_name: "مورد", invoice_total: 100, payment_status: "مدفوع" }],
  traceability: [{
    request: { id: "request-1", request_number: "REQ-1", status: "converted_to_purchase" },
    comparisons: [{
      id: "comparison-1", comparison_number: "CMP-1", comparison_date: "2026-08-16",
      approvals: [{
        id: "approval-1", approval_number: "APR-1", status: "approved",
        approval_stage: "funds_release", revision_number: 0,
        purchase_orders: [{
          id: "po-1", po_number: "PO-1", supplier_name: "مورد", status: "partial_received",
          receipt_summary: { ordered_quantity: 10, received_quantity: 6, remaining_quantity: 4 },
          receipt_count: 1,
        }],
      }],
    }],
  }],
  payments: [], timeline: [],
};

jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ projectId: "project-1" }),
}), { virtual: true });
jest.mock("@/lib/api", () => ({
  __esModule: true, fmtEGP: (value) => `${value} ج.م`, errMsg: () => "خطأ",
  default: { get: (...args) => mockGet(...args) },
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));

beforeEach(() => {
  mockGet.mockReset();
  mockNavigate.mockReset();
});

test("shows the six formal project KPIs and keeps legacy purchasing separate", async () => {
  mockGet.mockResolvedValue({ data: hub });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ProjectPurchases />); await new Promise((resolve) => setTimeout(resolve, 50)); });

  expect(mockGet).toHaveBeenCalledWith("/workflow/projects/project-1/procurement-hub");
  expect(container.querySelector('[data-testid="project-formal-kpis"]').children).toHaveLength(6);
  expect(container.querySelector('[data-testid="project-formal-kpis"]').textContent).toContain("قيمة أوامر الشراء");
  expect(container.querySelector('[data-testid="project-formal-kpis"]').textContent).toContain("المتبقي");
  expect(container.querySelector('[data-testid="project-actions"]').textContent).toContain("إعداد مقارنة الموردين: 1");
  expect(container.querySelector('[data-testid="project-actions"]').textContent).toContain("متابعة التوريد: 1");
  expect([...container.querySelectorAll("button")].some((button) => button.textContent === "الشراء المباشر")).toBe(false);
  expect(container.textContent).toContain("بيانات شراء مباشر قديمة (منفصلة عن المؤشرات الرسمية)");
  const requestsTab = [...container.querySelectorAll("button")]
    .find((button) => button.textContent === "الطلبات");
  await act(async () => requestsTab.click());
  expect(container.textContent).toContain("قيد التسعير");

  await act(async () => root.unmount());
  container.remove();
});

test("opens an existing project purchase in its detail route", async () => {
  mockGet.mockResolvedValue({ data: hub });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ProjectPurchases />); await new Promise((resolve) => setTimeout(resolve, 100)); });
  const purchaseCard = [...container.querySelectorAll("button")].find((button) => button.textContent.includes("PUR-000001"));
  await act(async () => purchaseCard.click());
  expect(mockNavigate).toHaveBeenCalledWith("/purchases/PUR-000001");
  await act(async () => root.unmount());
  container.remove();
});

test("shows real receiving progress from the project hub", async () => {
  mockGet.mockResolvedValue({ data: {
    ...hub,
    purchase_orders: [{
      ...hub.purchase_orders[0], status: "partial_received", receipt_count: 1,
      receipt_summary: { ordered_quantity: 10, received_quantity: 6, remaining_quantity: 4 },
    }],
  } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ProjectPurchases />); await new Promise((resolve) => setTimeout(resolve, 50)); });
  const receivingTab = [...container.querySelectorAll("button")].find((button) => button.textContent.trim() === "الاستلام");
  await act(async () => receivingTab.click());
  expect(container.textContent).toContain("استلام جزئي");
  expect(container.textContent).toContain("مستلم 6 من 10");
  await act(async () => root.unmount());
  container.remove();
});

test("shows the linked REQ CMP APR PO chain inside the overview", async () => {
  mockGet.mockResolvedValue({ data: hub });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ProjectPurchases />); await new Promise((resolve) => setTimeout(resolve, 50)); });
  expect(container.textContent).toContain("REQ-1");
  expect(container.textContent).toContain("CMP-1");
  expect(container.textContent).toContain("APR-1");
  expect(container.textContent).toContain("PO-1");
  expect(container.textContent).toContain("الاستلام: 6/10");
  await act(async () => root.unmount());
  container.remove();
});
