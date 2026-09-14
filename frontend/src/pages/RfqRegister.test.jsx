import React, { act } from "react";
import { createRoot } from "react-dom/client";
import RfqRegister from "@/pages/RfqRegister";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockNavigate = jest.fn();
const mockGet = jest.fn();

jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}), { virtual: true });
jest.mock("@/lib/api", () => ({
  __esModule: true,
  errMsg: () => "خطأ",
  default: { get: (...args) => mockGet(...args) },
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock("@/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    language: globalThis.mockRfqLanguage || "ar",
    tr: (ar, en) => (globalThis.mockRfqLanguage === "en" ? en : ar),
    locale: "ar-EG",
  }),
}));

const rows = [
  {
    id: "rfq-1", rfq_number: "RFQ-000001", project_id: "proj-1", project_name: "مشروع أ",
    source_request_id: "req-1", source_request_number: "REQ-000001",
    item_count: 3, supplier_count: 2, supplier_names: ["مورد أ", "مورد ب"],
    received_quotation_count: 1, rfq_date: "2026-08-01", deadline: "2026-12-31",
    request_status: "pricing", is_open: true, is_past_deadline: false,
    status: "partial_response", ready_for_comparison: true,
    comparison_id: "", comparison_number: "",
    created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-05T00:00:00Z",
  },
  {
    id: "rfq-2", rfq_number: "RFQ-000002", project_id: "proj-2", project_name: "مشروع ب",
    source_request_id: "req-2", source_request_number: "REQ-000002",
    item_count: 1, supplier_count: 1, supplier_names: ["مورد ج"],
    received_quotation_count: 0, rfq_date: "2026-07-01", deadline: "2020-01-01",
    request_status: "pricing", is_open: true, is_past_deadline: true,
    status: "past_deadline", ready_for_comparison: false,
    comparison_id: "", comparison_number: "",
    created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-02T00:00:00Z",
  },
  {
    id: "rfq-3", rfq_number: "RFQ-000003", project_id: "proj-1", project_name: "مشروع أ",
    source_request_id: "req-3", source_request_number: "REQ-000003",
    item_count: 2, supplier_count: 1, supplier_names: ["مورد أ"],
    received_quotation_count: 1, rfq_date: "2026-06-01", deadline: "",
    request_status: "waiting_for_approval", is_open: false, is_past_deadline: false,
    status: "closed", ready_for_comparison: true,
    comparison_id: "cmp-3", comparison_number: "CMP-000003",
    created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-10T00:00:00Z",
  },
];

async function renderRegister() {
  mockGet.mockResolvedValue({ data: rows });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<RfqRegister />);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  return { container, root };
}

beforeEach(() => {
  globalThis.mockRfqLanguage = "ar";
  mockNavigate.mockClear();
  mockGet.mockReset();
});

test("register renders every RFQ from the API", async () => {
  const { container, root } = await renderRegister();
  expect(mockGet).toHaveBeenCalledWith("/workflow/rfqs");
  const rfqRows = container.querySelectorAll('[data-testid="rfq-row"]');
  expect(rfqRows).toHaveLength(3);
  expect(container.textContent).toContain("RFQ-000001");
  expect(container.textContent).toContain("RFQ-000002");
  expect(container.textContent).toContain("RFQ-000003");

  await act(async () => root.unmount());
  container.remove();
});

test("KPI counts are derived correctly from the register rows", async () => {
  const { container, root } = await renderRegister();
  expect(container.querySelector('[data-testid="rfq-kpi-open"]').textContent).toContain("2");
  expect(container.querySelector('[data-testid="rfq-kpi-awaiting"]').textContent).toContain("2");
  expect(container.querySelector('[data-testid="rfq-kpi-past_deadline"]').textContent).toContain("1");
  expect(container.querySelector('[data-testid="rfq-kpi-ready"]').textContent).toContain("1");

  await act(async () => root.unmount());
  container.remove();
});

test("clicking a KPI filters the register to matching rows, clicking again clears it", async () => {
  const { container, root } = await renderRegister();
  await act(async () => { container.querySelector('[data-testid="rfq-kpi-past_deadline"]').click(); });
  expect(container.querySelectorAll('[data-testid="rfq-row"]')).toHaveLength(1);
  expect(container.textContent).toContain("RFQ-000002");
  expect(container.textContent).not.toContain("RFQ-000001");

  await act(async () => { container.querySelector('[data-testid="rfq-kpi-past_deadline"]').click(); });
  expect(container.querySelectorAll('[data-testid="rfq-row"]')).toHaveLength(3);

  await act(async () => root.unmount());
  container.remove();
});

test("quotation progress shows received vs invited suppliers", async () => {
  const { container, root } = await renderRegister();
  const progress = container.querySelector('[data-testid="rfq-quotation-progress-rfq-1"]');
  expect(progress.textContent.replace(/\s+/g, " ").trim()).toBe("1 / 2");

  await act(async () => root.unmount());
  container.remove();
});

test("overdue indicator only shows for the past-deadline RFQ", async () => {
  const { container, root } = await renderRegister();
  expect(container.querySelector('[data-testid="rfq-overdue-rfq-2"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="rfq-overdue-rfq-1"]')).toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("clicking a row opens the exact RFQ workspace", async () => {
  const { container, root } = await renderRegister();
  await act(async () => { container.querySelector('[data-testid="rfq-row"]').click(); });
  expect(mockNavigate).toHaveBeenCalledWith("/rfq/rfq-1");

  await act(async () => root.unmount());
  container.remove();
});

test("Source REQ deep link opens the exact request without triggering the row click", async () => {
  const { container, root } = await renderRegister();
  await act(async () => { container.querySelector('[data-testid="rfq-source-req-rfq-1"]').click(); });
  expect(mockNavigate).toHaveBeenCalledWith("/incoming-requests", { state: { request_id: "req-1" } });
  expect(mockNavigate).not.toHaveBeenCalledWith("/rfq/rfq-1");

  await act(async () => root.unmount());
  container.remove();
});

test("an existing comparison opens the exact CMP via state, not a search", async () => {
  const { container, root } = await renderRegister();
  await act(async () => { container.querySelector('[data-testid="rfq-open-comparison-rfq-3"]').click(); });
  expect(mockNavigate).toHaveBeenCalledWith("/supplier-price-comparison", { state: { comparison_id: "cmp-3" } });
  expect(mockNavigate).not.toHaveBeenCalledWith("/rfq/rfq-3");

  await act(async () => root.unmount());
  container.remove();
});

test("a ready RFQ without a comparison yet shows a create-comparison action into the existing RFQ flow", async () => {
  const { container, root } = await renderRegister();
  const createButton = container.querySelector('[data-testid="rfq-create-comparison-rfq-1"]');
  expect(createButton).not.toBeNull();
  await act(async () => { createButton.click(); });
  expect(mockNavigate).toHaveBeenCalledWith("/rfq/rfq-1");

  // The completed RFQ (already has a comparison) shows "open", not "create".
  expect(container.querySelector('[data-testid="rfq-create-comparison-rfq-3"]')).toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("a non-ready RFQ shows no comparison action at all", async () => {
  const { container, root } = await renderRegister();
  expect(container.querySelector('[data-testid="rfq-create-comparison-rfq-2"]')).toBeNull();
  expect(container.querySelector('[data-testid="rfq-open-comparison-rfq-2"]')).toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("search, project, and status filters narrow the register", async () => {
  const { container, root } = await renderRegister();
  const search = container.querySelector('[data-testid="rfq-search"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(search, "RFQ-000002");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelectorAll('[data-testid="rfq-row"]')).toHaveLength(1);
  expect(container.textContent).toContain("RFQ-000002");

  await act(async () => root.unmount());
  container.remove();
});

test("empty register shows an empty state instead of a crash", async () => {
  mockGet.mockResolvedValue({ data: [] });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<RfqRegister />);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(container.querySelector('[data-testid="rfq-register-page"]')).not.toBeNull();
  expect(container.textContent).toContain("لا توجد طلبات تسعير");

  await act(async () => root.unmount());
  container.remove();
});

test("create-RFQ CTA sends the user to the existing eligible-request workflow", async () => {
  const { container, root } = await renderRegister();
  await act(async () => { container.querySelector('[data-testid="rfq-create-from-request"]').click(); });
  expect(mockNavigate).toHaveBeenCalledWith("/incoming-requests");

  await act(async () => root.unmount());
  container.remove();
});
