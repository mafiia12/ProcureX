import React, { act } from "react";
import { createRoot } from "react-dom/client";
import IncomingPurchaseRequests from "@/pages/IncomingPurchaseRequests";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockInternalGet = jest.fn();
const mockDocumentGet = jest.fn();

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: { request_id: "req-1" } }),
  Link: ({ children, to, ...props }) => <a href={typeof to === "string" ? to : "#"} {...props}>{children}</a>,
}), { virtual: true });
jest.mock("@/lib/requestApi", () => ({
  internalRequestApi: {
    get: (...args) => mockInternalGet(...args),
    patch: jest.fn(), post: jest.fn(),
  },
  requestError: () => "خطأ",
}));
jest.mock("@/lib/documentCaptureApi", () => ({
  internalDocumentApi: { get: (...args) => mockDocumentGet(...args) },
}));
const mockPost = jest.fn();
const mockApiGet = jest.fn();
const mockApiPatch = jest.fn();
jest.mock("@/lib/api", () => ({
  __esModule: true, errMsg: (error) => error?.response?.data?.detail || "خطأ",
  default: {
    get: (...args) => mockApiGet(...args),
    post: (...args) => mockPost(...args),
    patch: (...args) => mockApiPatch(...args),
  },
}));
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
jest.mock("sonner", () => ({ toast: { error: (...a) => mockToastError(...a), success: (...a) => mockToastSuccess(...a) } }));
const mockUseAuth = jest.fn();
jest.mock("@/contexts/AuthContext", () => ({ useAuth: (...a) => mockUseAuth(...a) }));

const detail = {
  id: "req-1", request_number: "REQ-1", status: "pricing", created_at: "2026-08-17T10:00:00Z",
  requester_name: "مهندس الموقع", company_name: "عميل", phone_number: "01000000000",
  whatsapp_number: "", email: "", project_id: "project-1", project_name: "مشروع أ",
  project_location: "القاهرة", delivery_location: "الموقع", required_delivery_date: "2026-08-20",
  priority: "normal", assigned_employee: "مهندس المشتريات", notes: "", converted_customer_id: "",
  converted_document: null, status_history: [], internal_notes: [],
  items: [{ id: "ri-1", position: 1, product_name: "أسمنت", quantity: 10, unit: "شيكارة", review_status: "approved" }],
};

const mixedDetail = {
  ...detail,
  items: [
    {
      id: "ri-manual", position: 1, item_id: "", product_name: "أسمنت غير مسجل",
      quantity: 5, unit: "كيس", specifications: "أبيض مقاوم", review_status: "pending",
    },
    {
      id: "ri-master", position: 2, item_id: "item-99", product_name: "سيليكون",
      quantity: 2, unit: "أنبوبة", specifications: "", review_status: "pending",
    },
  ],
};

async function renderWithDetail(detailFixture) {
  mockInternalGet.mockImplementation((path) => {
    if (path === "/notifications/unread-count") return Promise.resolve({ data: { count: 0 } });
    if (path === "/req-1") return Promise.resolve({ data: detailFixture });
    return Promise.resolve({ data: [{ ...detailFixture, item_count: detailFixture.items.length }] });
  });
  mockDocumentGet.mockResolvedValue({ data: [] });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<IncomingPurchaseRequests />);
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
  mockPost.mockClear();
  mockApiPatch.mockReset();
  mockNavigate.mockClear();
  mockApiGet.mockReset();
  mockApiGet.mockRejectedValue(new Error("no rfq"));
  mockToastSuccess.mockClear();
  mockToastError.mockClear();
  mockUseAuth.mockReturnValue({ user: { username: "admin1", role: "admin", account_type: "erp" } });
});

test("a WhatsApp-sourced request shows a subtle WhatsApp badge in the list row; others show none", async () => {
  const { container, root } = await renderWithDetail({ ...detail, source: "whatsapp" });
  const row = container.querySelector('[data-testid="incoming-request-list-item"]');
  expect(row.textContent).toContain("واتساب");
  await act(async () => root.unmount());

  const { container: plainContainer, root: plainRoot } = await renderWithDetail({ ...detail, source: "site_portal" });
  const plainRow = plainContainer.querySelector('[data-testid="incoming-request-list-item"]');
  expect(plainRow.textContent).not.toContain("واتساب");
  await act(async () => plainRoot.unmount());
});

test("current request actions exclude obsolete customer and purchase draft conversions", async () => {
  const { container, root } = await renderWithDetail(detail);
  expect(container.querySelector('[data-testid="create-rfq-button"]')).not.toBeNull();
  for (const label of ["تحويل إلى عميل", "طلب شراء داخلي", "مسودة شراء"]) {
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent.includes(label))).toBe(false);
  }
  await act(async () => root.unmount());
  container.remove();
});

test("convert action appears only on the manual line, not the Master-linked line", async () => {
  const { container, root } = await renderWithDetail(mixedDetail);

  const buttons = container.querySelectorAll('[data-testid="convert-manual-item-button"]');
  expect(buttons.length).toBe(1);
  expect(container.textContent).toContain("صنف يدوي");

  await act(async () => root.unmount());
  container.remove();
});

test("the review dialog opens pre-filled from the manual line", async () => {
  const { container, root } = await renderWithDetail(mixedDetail);

  await click(container.querySelector('[data-testid="convert-manual-item-button"]'));

  // Radix Dialog portals its content to document.body, outside `container`.
  expect(document.querySelector('[data-testid="convert-manual-item-dialog"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="convert-form-name"]').value).toBe("أسمنت غير مسجل");
  expect(document.querySelector('[data-testid="convert-form-unit"]').value).toBe("كيس");

  await act(async () => root.unmount());
  container.remove();
});

test("a successful conversion posts to the convert endpoint and shows the linked item code", async () => {
  mockPost.mockResolvedValue({ data: { created: true, item_id: "new-item-1", item_code: "ITM-000042", item_name: "أسمنت غير مسجل" } });
  const { container, root } = await renderWithDetail(mixedDetail);

  await click(container.querySelector('[data-testid="convert-manual-item-button"]'));
  await click(document.querySelector('[data-testid="convert-form-submit"]'));

  expect(mockPost).toHaveBeenCalledWith(
    "/internal/incoming-purchase-requests/req-1/items/ri-manual/convert-to-item",
    expect.objectContaining({ name: "أسمنت غير مسجل", unit: "كيس" }),
  );
  expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining("ITM-000042"));

  await act(async () => root.unmount());
  container.remove();
});

test("existing Master-linked lines never render the convert button", async () => {
  const { container, root } = await renderWithDetail(mixedDetail);

  const rows = container.querySelectorAll('[data-testid="convert-manual-item-button"]');
  // Only the manual row's button exists; the Master row (item-99) has none.
  expect(rows.length).toBe(1);
  expect(container.textContent).toContain("سيليكون");

  await act(async () => root.unmount());
  container.remove();
});

test("a commercial manager sees both the technical review actions and the convert button (inherited from engineer/responsible)", async () => {
  mockUseAuth.mockReturnValue({ user: { username: "manager1", role: "commercial_manager", account_type: "erp" } });
  const underReview = { ...mixedDetail, status: "under_review" };
  const { container, root } = await renderWithDetail(underReview);

  expect(container.querySelector('[data-testid="technical-review-actions"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="convert-manual-item-button"]')).not.toBeNull();
  expect(container.textContent).toContain("صنف يدوي");

  await act(async () => root.unmount());
  container.remove();
});

test("reopened pricing-ready request hides technical approval controls", async () => {
  mockInternalGet.mockImplementation((path) => {
    if (path === "/notifications/unread-count") return Promise.resolve({ data: { count: 0 } });
    if (path === "/req-1") return Promise.resolve({ data: detail });
    return Promise.resolve({ data: [{ ...detail, item_count: 1 }] });
  });
  mockDocumentGet.mockResolvedValue({ data: [] });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<IncomingPurchaseRequests />);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  expect(container.querySelector('[data-testid="technical-review-complete"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="technical-review-actions"]')).toBeNull();
  expect(container.textContent).toContain("تمت المراجعة الفنية");
  expect(container.textContent).toContain("جاهز للتسعير والمقارنة");

  await act(async () => root.unmount());
  container.remove();
});

test("procurement_responsible sees a Create RFQ action on a pricing-ready, project-linked request with no RFQ yet", async () => {
  mockUseAuth.mockReturnValue({ user: { username: "resp1", role: "procurement_responsible", account_type: "erp" } });
  const { container, root } = await renderWithDetail(detail);

  expect(container.querySelector('[data-testid="rfq-panel"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="create-rfq-button"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="open-rfq-button"]')).toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("procurement_engineer does not see the Create RFQ action", async () => {
  mockUseAuth.mockReturnValue({ user: { username: "eng1", role: "procurement_engineer", account_type: "erp" } });
  const { container, root } = await renderWithDetail(detail);

  expect(container.querySelector('[data-testid="create-rfq-button"]')).toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("approved subset enables a confirmed partial progression while returned items remain excluded", async () => {
  mockUseAuth.mockReturnValue({ user: { username: "eng1", role: "procurement_engineer", account_type: "erp" } });
  const underReview = {
    ...detail, status: "under_review",
    items: [
      { ...detail.items[0], id: "approved-1", review_status: "approved" },
      { ...detail.items[0], id: "rejected-1", product_name: "مرفوض", review_status: "rejected", review_reason: "غير مطلوب" },
      { ...detail.items[0], id: "returned-1", product_name: "ناقص", review_status: "need_clarification", review_reason: "أكمل المواصفة" },
    ],
  };
  mockPost.mockResolvedValue({ data: { ok: true, status: "pricing", eligible_item_count: 1, returned_item_count: 2 } });
  const { container, root } = await renderWithDetail(underReview);
  expect(container.querySelector('[data-testid="partial-review-summary"]').textContent).toContain("1");
  const progress = container.querySelector('[data-testid="approve-eligible-items"]');
  expect(progress.disabled).toBe(false);
  await click(progress);
  expect(document.querySelector('[data-testid="eligible-items-confirmation"]')).not.toBeNull();
  await click(document.querySelector('[data-testid="confirm-eligible-items"]'));
  expect(mockPost).toHaveBeenCalledWith(
    "/workflow/incoming-purchase-requests/req-1/technical-decision",
    expect.objectContaining({ decision: "approved_for_pricing" }),
  );
  await act(async () => root.unmount());
});

test("creating an RFQ posts the request id and navigates to the RFQ workspace", async () => {
  mockUseAuth.mockReturnValue({ user: { username: "resp1", role: "procurement_responsible", account_type: "erp" } });
  mockPost.mockResolvedValue({ data: { already_exists: false, rfq: { id: "rfq-1" } } });
  const { container, root } = await renderWithDetail(detail);

  await click(container.querySelector('[data-testid="create-rfq-button"]'));

  expect(mockPost).toHaveBeenCalledWith(
    "/workflow/rfqs",
    expect.objectContaining({ source_request_id: "req-1" }),
  );
  expect(mockNavigate).toHaveBeenCalledWith("/rfq/rfq-1");

  await act(async () => root.unmount());
  container.remove();
});

test("an existing RFQ renders its summary with an Open RFQ action instead of Create", async () => {
  mockApiGet.mockImplementation((path) => {
    if (path === "/workflow/rfqs/by-request/req-1") {
      return Promise.resolve({ data: {
        id: "rfq-9", rfq_number: "RFQ-000009", supplier_count: 2,
        received_quotation_count: 1, deadline: "2026-09-01",
      } });
    }
    return Promise.reject(new Error("unexpected"));
  });
  const { container, root } = await renderWithDetail(detail);

  expect(container.querySelector('[data-testid="create-rfq-button"]')).toBeNull();
  const openButton = container.querySelector('[data-testid="open-rfq-button"]');
  expect(openButton).not.toBeNull();
  expect(container.textContent).toContain("RFQ-000009");

  await click(openButton);
  expect(mockNavigate).toHaveBeenCalledWith("/rfq/rfq-9");

  await act(async () => root.unmount());
  container.remove();
});

test("saving an item's review status goes through the authenticated API client, not the legacy internal-token client", async () => {
  mockUseAuth.mockReturnValue({ user: { username: "eng1", role: "procurement_engineer", account_type: "erp" } });
  mockApiPatch.mockResolvedValue({ data: { ...detail } });
  const { container, root } = await renderWithDetail(detail);

  await click(container.querySelector('[data-testid="item-review-menu"]'));
  const saveButton = [...container.querySelectorAll("button")]
    .find((button) => button.textContent.includes("حفظ حالة الصنف"));
  await click(saveButton);

  // The endpoint requires require_erp_role() - it must go through the
  // authenticated `api` client (which attaches the JWT), never
  // internalRequestApi (which only ever sends X-Internal-Token).
  expect(mockApiPatch).toHaveBeenCalledWith(
    "/internal/incoming-purchase-requests/req-1/items/ri-1/review",
    expect.objectContaining({ status: "approved" }),
  );

  await act(async () => root.unmount());
  container.remove();
});

test("a valid procurement_engineer session saves the item review successfully with no false login-required error", async () => {
  mockUseAuth.mockReturnValue({ user: { username: "eng1", role: "procurement_engineer", account_type: "erp" } });
  mockApiPatch.mockResolvedValue({ data: { ...detail } });
  const { container, root } = await renderWithDetail(detail);

  await click(container.querySelector('[data-testid="item-review-menu"]'));
  const saveButton = [...container.querySelectorAll("button")]
    .find((button) => button.textContent.includes("حفظ حالة الصنف"));
  await click(saveButton);

  expect(mockToastSuccess).toHaveBeenCalledWith("تم تحديث حالة الصنف");
  expect(mockToastError).not.toHaveBeenCalled();

  await act(async () => root.unmount());
  container.remove();
});
