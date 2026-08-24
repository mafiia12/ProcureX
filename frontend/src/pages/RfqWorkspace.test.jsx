import React, { act } from "react";
import { createRoot } from "react-dom/client";
import RfqWorkspace from "@/pages/RfqWorkspace";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockNavigate = jest.fn();
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();

jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ rfqId: "rfq-1" }),
}), { virtual: true });
jest.mock("@/lib/api", () => ({
  __esModule: true,
  fmtEGP: (value) => `${Number(value || 0).toFixed(2)} ج.م`,
  errMsg: () => "خطأ",
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
    put: (...args) => mockPut(...args),
  },
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
const mockUseAuth = jest.fn();
jest.mock("@/contexts/AuthContext", () => ({ useAuth: (...a) => mockUseAuth(...a) }));

const rfq = {
  id: "rfq-1", rfq_number: "RFQ-000001", source_request_id: "req-1",
  source_request_number: "REQ-1", project_id: "project-1", project_name: "مشروع أ",
  rfq_date: "2026-08-20", deadline: "2026-09-01", notes: "",
  items: [
    { id: "rfqi-1", source_request_item_id: "ri-1", item_id: "item-1", product_name: "أسمنت", specifications: "", quantity: 10, unit: "شيكارة", position: 1 },
  ],
  suppliers: [
    { id: "rfqs-1", supplier_id: "sup-1", supplier_name: "مورد أ", added_at: "2026-08-20" },
  ],
  quotations: [],
  supplier_count: 1, received_quotation_count: 0,
};

async function renderWorkspace() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<RfqWorkspace />);
    await new Promise((resolve) => setTimeout(resolve, 100));
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
  mockNavigate.mockClear();
  mockGet.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockUseAuth.mockReturnValue({ user: { username: "resp1", role: "procurement_responsible", account_type: "erp" } });
  mockGet.mockImplementation((path) => {
    if (path === "/workflow/rfqs/rfq-1") return Promise.resolve({ data: rfq });
    if (path === "/suppliers") return Promise.resolve({ data: [{ id: "sup-2", code: "SUP-000002", name: "مورد ب" }] });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

test("renders RFQ header and requested items", async () => {
  const { container, root } = await renderWorkspace();

  expect(container.querySelector('[data-testid="rfq-number"]').textContent).toBe("RFQ-000001");
  expect(container.textContent).toContain("أسمنت");
  expect(container.textContent).toContain("مورد أ");

  await act(async () => root.unmount());
  container.remove();
});

test("procurement_responsible sees supplier management and quotation actions", async () => {
  const { container, root } = await renderWorkspace();

  expect(container.querySelector('[data-testid="rfq-add-supplier-button"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="rfq-open-quotation-button"]')).not.toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("a read-only role does not see supplier management or quotation actions", async () => {
  mockUseAuth.mockReturnValue({ user: { username: "eng1", role: "procurement_engineer", account_type: "erp" } });
  const { container, root } = await renderWorkspace();

  expect(container.querySelector('[data-testid="rfq-add-supplier-button"]')).toBeNull();
  expect(container.querySelector('[data-testid="rfq-open-quotation-button"]')).toBeNull();
  // Still visible: read access for all ERP users.
  expect(container.textContent).toContain("RFQ-000001");

  await act(async () => root.unmount());
  container.remove();
});

test("opening a quotation creates/fetches it and pre-fills lines from the RFQ items", async () => {
  mockPost.mockImplementation((path) => {
    if (path === "/workflow/rfqs/rfq-1/quotations") {
      return Promise.resolve({ data: { already_exists: false, quotation: {
        id: "quo-1", status: "draft", quotation_ref: "", quotation_date: "", valid_until: "",
        payment_terms: "", delivery_terms: "", currency: "EGP", notes: "",
        attachment_count: 0, lines: [],
      } } });
    }
    return Promise.reject(new Error(`unexpected POST ${path}`));
  });
  const { container, root } = await renderWorkspace();

  await click(container.querySelector('[data-testid="rfq-open-quotation-button"]'));

  expect(mockPost).toHaveBeenCalledWith(
    "/workflow/rfqs/rfq-1/quotations", { supplier_id: "sup-1" },
  );
  const dialog = document.querySelector('[data-testid="quotation-dialog"]');
  expect(dialog).not.toBeNull();
  expect(document.querySelectorAll('[data-testid="quotation-line-row"]').length).toBe(1);

  await act(async () => root.unmount());
  container.remove();
});

test("Mark Received saves quotation lines with status received", async () => {
  mockPost.mockImplementation((path) => {
    if (path === "/workflow/rfqs/rfq-1/quotations") {
      return Promise.resolve({ data: { already_exists: false, quotation: {
        id: "quo-1", status: "draft", quotation_ref: "", quotation_date: "", valid_until: "",
        payment_terms: "", delivery_terms: "", currency: "EGP", notes: "",
        attachment_count: 0, lines: [],
      } } });
    }
    return Promise.reject(new Error(`unexpected POST ${path}`));
  });
  mockPut.mockResolvedValue({ data: { status: "received" } });
  const { container, root } = await renderWorkspace();

  await click(container.querySelector('[data-testid="rfq-open-quotation-button"]'));
  await click(document.querySelector('[data-testid="mark-received-button"]'));

  expect(mockPut).toHaveBeenCalledWith(
    "/workflow/rfqs/rfq-1/quotations/quo-1",
    expect.objectContaining({
      status: "received",
      lines: [expect.objectContaining({ rfq_item_id: "rfqi-1", quantity: 10, unit: "شيكارة" })],
    }),
  );

  await act(async () => root.unmount());
  container.remove();
});

test("Prepare price comparison fetches comparison rows and navigates with them", async () => {
  mockGet.mockImplementation((path) => {
    if (path === "/workflow/rfqs/rfq-1") return Promise.resolve({ data: rfq });
    if (path === "/suppliers") return Promise.resolve({ data: [] });
    if (path === "/workflow/rfqs/rfq-1/comparison-rows") {
      return Promise.resolve({ data: {
        source_request_id: "req-1", source_request_number: "REQ-1", project_name: "مشروع أ",
        rows: [{ item_id: "item-1", supplier_id: "sup-1", supplier_name: "مورد أ", quantity: 10, unit_price: 50 }],
      } });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  const { container, root } = await renderWorkspace();

  await click(container.querySelector('[data-testid="prepare-comparison-button"]'));

  expect(mockNavigate).toHaveBeenCalledWith(
    "/supplier-price-comparison",
    expect.objectContaining({
      state: expect.objectContaining({
        rfqRows: [expect.objectContaining({ supplier_id: "sup-1", unit_price: 50 })],
      }),
    }),
  );

  await act(async () => root.unmount());
  container.remove();
});
