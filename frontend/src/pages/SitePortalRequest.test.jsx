import React, { act } from "react";
import { createRoot } from "react-dom/client";

import SitePortalRequest from "@/pages/SitePortalRequest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock("@/lib/api", () => ({
  __esModule: true,
  errMsg: (error) => error?.response?.data?.detail || "خطأ غير متوقع",
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
  },
}));

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() },
}));

jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
}), { virtual: true });

const mockLogout = jest.fn();
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { display_name: "مهندس الموقع" }, logout: mockLogout }),
}));
jest.mock("@/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    language: globalThis.mockPortalLanguage || "ar",
    direction: globalThis.mockPortalLanguage === "en" ? "ltr" : "rtl",
    locale: globalThis.mockPortalLanguage === "en" ? "en-EG" : "ar-EG",
    tr: (arabic, english) => globalThis.mockPortalLanguage === "en" ? english : arabic,
  }),
}));

// Same recipe as every other page test in this repo (see Payments.test.jsx) —
// Radix Select needs pointer-capture APIs jsdom doesn't implement.
jest.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children, ...rest }) => (
    <select {...rest} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }) => <>{children}</>,
  SelectItem: ({ value, children }) => <option value={value}>{children}</option>,
}));

const SINGLE_PROJECT_CONTEXT = {
  requester_name: "مهندس الموقع",
  projects: [{ id: "proj-1", code: "PRJ-000001", name: "مشروع الاختبار" }],
  default_project_id: "proj-1",
};
const MULTI_PROJECT_CONTEXT = {
  requester_name: "مهندس الموقع",
  projects: [
    { id: "proj-1", code: "PRJ-000001", name: "مشروع أ" },
    { id: "proj-2", code: "PRJ-000002", name: "مشروع ب" },
  ],
  default_project_id: null,
};
const CEMENT = { id: "item-1", code: "ITM-000001", name: "أسمنت أبيض", unit: "كيس", main_category: "مواد بناء" };
const SILICONE = { id: "item-2", code: "ITM-000002", name: "سيليكون", unit: "أنبوبة", main_category: "كيماويات" };

function mockContextAndItems({ context = SINGLE_PROJECT_CONTEXT, previous = [], search = [], portalRequests = [], returnedItems = [] } = {}) {
  mockGet.mockImplementation((url, config) => {
    if (url === "/portal/context") return Promise.resolve({ data: context });
    if (url === "/portal/previous-items") return Promise.resolve({ data: previous });
    if (url === "/portal/items") return Promise.resolve({ data: search });
    if (url === "/portal/purchase-requests") return Promise.resolve({ data: portalRequests });
    if (url === "/portal/returned-items") return Promise.resolve({ data: returnedItems });
    return Promise.resolve({ data: [] });
  });
}

async function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SitePortalRequest />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

async function click(element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

function setInputValue(input, value) {
  const proto = input.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.mockPortalLanguage = "ar";
  document.body.innerHTML = "";
});

test("clarification workflow uses clear English labels and LTR direction", async () => {
  globalThis.mockPortalLanguage = "en";
  mockContextAndItems({ portalRequests: [{
    id: "req-en", request_number: "REQ-EN-1", project_name: "Project A",
    status: "need_clarification", created_at: "2026-08-20T10:00:00Z", updated_at: "2026-08-21T10:00:00Z",
    clarification: { reason: "Provide dimensions", requested_by: "engineer", requested_at: "2026-08-21T10:00:00Z" },
  }] });
  const { container, root } = await renderPage();
  expect(container.firstElementChild.getAttribute("dir")).toBe("ltr");
  for (const label of ["Purchase Request Portal", "My Recent Requests", "Needs Clarification", "Clarification Response", "Resubmit for Review", "Submit Purchase Request"]) {
    expect(container.textContent).toContain(label);
  }
  expect(container.textContent).not.toContain("إعادة الإرسال للمراجعة");
  await act(async () => root.unmount());
});

test("renders the request page for an authenticated site portal user", async () => {
  mockContextAndItems();
  const { container, root } = await renderPage();

  expect(container.querySelector('[data-testid="site-portal-request-page"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="portal-requester-name"]').textContent).toBe("مهندس الموقع");

  await act(async () => root.unmount());
});

test("uses a mobile-first request flow with collapsed secondary content and safe sticky actions", async () => {
  mockContextAndItems({
    previous: [CEMENT],
    portalRequests: [{
      id: "req-1", request_number: "REQ-1", project_name: "مشروع الاختبار",
      status: "new", created_at: "2026-08-20T10:00:00Z", updated_at: "2026-08-20T10:00:00Z",
    }],
  });
  const { container, root } = await renderPage();

  expect(container.querySelector('[data-testid="portal-request-context"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="portal-items-section"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="portal-request-history"]').hasAttribute("open")).toBe(false);
  expect(container.querySelector('[data-testid="portal-additional-details"]').hasAttribute("open")).toBe(false);
  const actions = container.querySelector('[data-testid="portal-sticky-actions"]');
  expect(actions.classList.contains("sticky")).toBe(true);
  expect(actions.classList.contains("bottom-0")).toBe(true);
  expect(actions.className).toContain("safe-area-inset-bottom");

  await click(container.querySelector('[data-testid="portal-previous-item-chip"]'));
  expect(container.querySelector('[data-testid="portal-request-row"]').className).toContain("grid-cols-[88px_minmax(0,1fr)_32px]");

  await act(async () => root.unmount());
});

test("required delivery date defaults to the local creation date and prevents earlier dates", async () => {
  mockContextAndItems();
  const { container, root } = await renderPage();
  const input = container.querySelector('[data-testid="portal-required-date"]');
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  const expected = new Date(now.getTime() - offset).toISOString().slice(0, 10);
  expect(input.value).toBe(expected);
  expect(input.min).toBe(expected);
  await act(async () => root.unmount());
});

function returnedItem(overrides = {}) {
  return {
    id: "returned-1", request_id: "req-original", request_number: "REQ-ORIGINAL",
    project_name: "مشروع الاختبار",
    product_name: "رخام", quantity: 2, unit: "م2", specifications: "سمك غير واضح",
    status: "need_clarification", reason: "حدد السمك", reviewer: "proc.engineer",
    reviewed_at: "2026-08-21T10:00:00Z", corrected_request: null, item_id: "",
    draft: null, ready: false,
    ...overrides,
  };
}

test("saving a correction only saves a draft — it never immediately creates a REQ", async () => {
  const returned = returnedItem();
  mockContextAndItems({ returnedItems: [returned] });
  mockPost.mockResolvedValue({ data: { ok: true, item_id: "returned-1", ready: true, draft: {} } });
  const { container, root } = await renderPage();
  expect(container.querySelector('[data-testid="returned-items-section"]')).not.toBeNull();
  expect(container.textContent).toContain("حدد السمك");
  await click(container.querySelector('[data-testid="correct-returned-item-returned-1"]'));
  expect(container.querySelector('[data-testid="returned-item-correction-dialog"]')).not.toBeNull();
  await click(container.querySelector('[data-testid="submit-corrected-item"]'));

  const call = mockPost.mock.calls.find(([url]) => url === "/portal/returned-items/returned-1/correct");
  expect(call).toBeDefined();
  expect(call[1]).toEqual(expect.objectContaining({ quantity: 2 }));
  // Only the draft-save call happened — no grouped resubmission request.
  expect(mockPost.mock.calls.some(([url]) => url.includes("resubmit-corrections"))).toBe(false);
  await act(async () => root.unmount());
});

test("the grouped resubmit button only counts ready items and shows their count", async () => {
  mockContextAndItems({ returnedItems: [
    returnedItem({ id: "returned-1", ready: true, draft: { product_name: "رخام" } }),
    returnedItem({ id: "returned-2", ready: true, draft: { product_name: "سيراميك" } }),
    returnedItem({ id: "returned-3", ready: true, draft: { product_name: "دهان" } }),
    returnedItem({ id: "returned-4", ready: false, draft: null }),
  ] });
  const { container, root } = await renderPage();

  const button = container.querySelector('[data-testid="resubmit-corrected-group-button"]');
  expect(button).not.toBeNull();
  expect(button.textContent).toContain("3");
  // The not-yet-corrected 4th item must not block or inflate the count.
  expect(button.textContent).not.toContain("4");

  await act(async () => root.unmount());
});

test("one grouped resubmit posts every ready item id together and creates one child REQ", async () => {
  mockContextAndItems({ returnedItems: [
    returnedItem({ id: "returned-1", ready: true, draft: { product_name: "رخام" } }),
    returnedItem({ id: "returned-2", ready: true, draft: { product_name: "سيراميك" } }),
  ] });
  mockPost.mockResolvedValue({ data: { ok: true, already_exists: false, request_number: "REQ-20260901-GROUPED", item_count: 2 } });
  const { container, root } = await renderPage();

  await click(container.querySelector('[data-testid="resubmit-corrected-group-button"]'));

  const call = mockPost.mock.calls.find(([url]) => url === "/portal/purchase-requests/req-original/resubmit-corrections");
  expect(call).toBeDefined();
  expect(call[1]).toEqual({ item_ids: ["returned-1", "returned-2"] });
  expect(mockPost).toHaveBeenCalledTimes(1);

  await act(async () => root.unmount());
});

test("shows an owned clarification and resubmits the same REQ with response and attachment", async () => {
  const clarificationRequest = {
    id: "req-clarify-1", request_number: "REQ-20260821-CLARIFY",
    project_name: "مشروع الاختبار", status: "need_clarification",
    created_at: "2026-08-20T10:00:00Z", updated_at: "2026-08-21T10:00:00Z",
    clarification: {
      reason: "وضح المقاس المطلوب", requested_by: "proc.engineer",
      requested_at: "2026-08-21T10:00:00Z", response_status: "awaiting_response",
    },
  };
  mockContextAndItems({ portalRequests: [clarificationRequest] });
  mockPost.mockResolvedValue({ data: { ok: true, request_id: clarificationRequest.id, status: "under_review" } });
  const { container, root } = await renderPage();

  expect(container.querySelector('[data-testid="portal-clarification-card"]')).not.toBeNull();
  expect(container.textContent).toContain("REQ-20260821-CLARIFY");
  expect(container.textContent).toContain("وضح المقاس المطلوب");
  await act(async () => {
    setInputValue(container.querySelector('[data-testid="portal-clarification-response"]'), "المقاس 60 × 60 سم");
    fileInputChange(container.querySelector('[data-testid="portal-clarification-attachments"]'), [
      new File(["image"], "size.png", { type: "image/png" }),
    ]);
  });
  await click(container.querySelector('[data-testid="portal-clarification-resubmit"]'));

  const clarificationCall = mockPost.mock.calls.find(([url]) => url === "/portal/purchase-requests/req-clarify-1/clarification");
  expect(clarificationCall).toBeDefined();
  expect(clarificationCall[1].get("response")).toBe("المقاس 60 × 60 سم");
  expect(clarificationCall[1].getAll("attachments")[0].name).toBe("size.png");
  await act(async () => root.unmount());
});

test("a single-project user sees the project as read-only context, not a selector", async () => {
  mockContextAndItems({ context: SINGLE_PROJECT_CONTEXT });
  const { container, root } = await renderPage();

  const readonly = container.querySelector('[data-testid="portal-project-readonly"]');
  expect(readonly).not.toBeNull();
  expect(readonly.textContent).toBe("مشروع الاختبار");
  expect(container.querySelector('[data-testid="portal-project-select"]')).toBeNull();

  await act(async () => root.unmount());
});

test("a multi-project user is shown a small project selector, not free entry", async () => {
  mockContextAndItems({ context: MULTI_PROJECT_CONTEXT });
  const { container, root } = await renderPage();

  const select = container.querySelector('[data-testid="portal-project-select"]');
  expect(select).not.toBeNull();
  expect(container.querySelectorAll('[data-testid="portal-project-select"] option').length).toBe(2);

  await act(async () => root.unmount());
});

test("delivery destination offers only site and warehouse, in Arabic", async () => {
  mockContextAndItems();
  const { container, root } = await renderPage();

  const select = container.querySelector('[data-testid="portal-destination-select"]');
  const options = Array.from(select.querySelectorAll("option")).map((o) => [o.value, o.textContent]);
  expect(options).toEqual([["site", "الموقع"], ["warehouse", "المخزن"]]);

  await act(async () => root.unmount());
});

test("item master search returns results the user can add to the request", async () => {
  mockContextAndItems({ search: [CEMENT] });
  const { container, root } = await renderPage();

  await act(async () => {
    setInputValue(container.querySelector('[data-testid="portal-item-search-input"]'), "اسمنت");
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  const result = container.querySelector('[data-testid="portal-item-search-result"]');
  expect(result).not.toBeNull();
  expect(result.textContent).toContain("أسمنت أبيض");

  await click(result);
  expect(container.querySelectorAll('[data-testid="portal-request-row"]').length).toBe(1);
  expect(container.textContent).toContain("أسمنت أبيض");

  await act(async () => root.unmount());
});

test("previously requested products render as quick-add chips and add without duplicating", async () => {
  mockContextAndItems({ previous: [CEMENT, SILICONE] });
  const { container, root } = await renderPage();

  const chips = container.querySelectorAll('[data-testid="portal-previous-item-chip"]');
  expect(chips.length).toBe(2);

  await click(chips[0]);
  await click(chips[0]);

  expect(container.querySelectorAll('[data-testid="portal-request-row"]').length).toBe(1);

  await act(async () => root.unmount());
});

test("no history yields an empty response and the previous-products section is hidden, not an error", async () => {
  mockContextAndItems({ previous: [] });
  const { container, root } = await renderPage();

  expect(container.querySelector('[data-testid="portal-previous-items"]')).toBeNull();

  await act(async () => root.unmount());
});

test("submit sends a server-derived project id and no requester identity fields", async () => {
  mockContextAndItems({ context: SINGLE_PROJECT_CONTEXT, previous: [CEMENT] });
  mockPost.mockResolvedValue({ data: { ok: true, request_number: "REQ-20260819-TEST" } });
  const { container, root } = await renderPage();

  await click(container.querySelector('[data-testid="portal-previous-item-chip"]'));
  await act(async () => {
    setInputValue(container.querySelector('[data-testid="portal-required-date"]'), "2027-01-01");
  });

  await click(container.querySelector('[data-testid="portal-submit-button"]'));

  expect(mockPost).toHaveBeenCalledTimes(1);
  const [url, form] = mockPost.mock.calls[0];
  expect(url).toBe("/portal/purchase-requests");
  const payload = JSON.parse(form.get("payload"));
  expect(payload.project_id).toBe("proj-1");
  expect(payload).not.toHaveProperty("requester_name");
  expect(payload).not.toHaveProperty("requester_user_id");
  expect(payload.items).toEqual([{ item_id: "item-1", quantity: 1, note: "" }]);

  await act(async () => root.unmount());
});

test("no assigned project blocks submission with a clear message", async () => {
  mockContextAndItems({ context: { requester_name: "مهندس الموقع", projects: [], default_project_id: null } });
  const { container, root } = await renderPage();

  expect(container.querySelector('[data-testid="no-project-message"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="portal-submit-button"]').disabled).toBe(true);

  await act(async () => root.unmount());
});

function fileInputChange(input, files) {
  Object.defineProperty(input, "files", { value: files, configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

test("the manual item button reveals a name/unit form, adds a badged row, and clears itself", async () => {
  mockContextAndItems();
  const { container, root } = await renderPage();

  expect(container.querySelector('[data-testid="portal-manual-item-form"]')).toBeNull();
  await click(container.querySelector('[data-testid="portal-add-manual-item-button"]'));
  expect(container.querySelector('[data-testid="portal-manual-item-form"]')).not.toBeNull();

  await act(async () => {
    setInputValue(container.querySelector('[data-testid="portal-manual-item-name"]'), "أسمنت غير مسجل");
    setInputValue(container.querySelector('[data-testid="portal-manual-item-unit"]'), "كيس");
  });
  await click(container.querySelector('[data-testid="portal-manual-item-add-button"]'));

  const rows = container.querySelectorAll('[data-testid="portal-request-row"]');
  expect(rows.length).toBe(1);
  expect(rows[0].dataset.manual).toBe("true");
  expect(rows[0].textContent).toContain("أسمنت غير مسجل");
  expect(container.querySelector('[data-testid="portal-row-manual-badge"]')).not.toBeNull();
  // Form closes and resets after a successful add.
  expect(container.querySelector('[data-testid="portal-manual-item-form"]')).toBeNull();

  await act(async () => root.unmount());
});

test("manual item requires both a name and a unit before it can be added", async () => {
  mockContextAndItems();
  const { container, root } = await renderPage();

  await click(container.querySelector('[data-testid="portal-add-manual-item-button"]'));
  await click(container.querySelector('[data-testid="portal-manual-item-add-button"]'));

  expect(container.querySelectorAll('[data-testid="portal-request-row"]').length).toBe(0);
  expect(container.querySelector('[data-testid="portal-manual-item-form"]')).not.toBeNull();

  await act(async () => root.unmount());
});

test("a request can mix a Master item and a manual item in the same list", async () => {
  mockContextAndItems({ previous: [CEMENT] });
  const { container, root } = await renderPage();

  await click(container.querySelector('[data-testid="portal-previous-item-chip"]'));
  await click(container.querySelector('[data-testid="portal-add-manual-item-button"]'));
  await act(async () => {
    setInputValue(container.querySelector('[data-testid="portal-manual-item-name"]'), "منتج يدوي");
    setInputValue(container.querySelector('[data-testid="portal-manual-item-unit"]'), "قطعة");
  });
  await click(container.querySelector('[data-testid="portal-manual-item-add-button"]'));

  const rows = container.querySelectorAll('[data-testid="portal-request-row"]');
  expect(rows.length).toBe(2);
  expect(rows[0].dataset.manual).toBe("false");
  expect(rows[1].dataset.manual).toBe("true");

  await act(async () => root.unmount());
});

test("the attachment picker accepts multiple files, lists them, and a removed file is dropped before submit", async () => {
  mockContextAndItems({ previous: [CEMENT] });
  mockPost.mockResolvedValue({ data: { ok: true, request_number: "REQ-20260819-TEST" } });
  const { container, root } = await renderPage();

  await click(container.querySelector('[data-testid="portal-previous-item-chip"]'));
  await act(async () => {
    setInputValue(container.querySelector('[data-testid="portal-required-date"]'), "2027-01-01");
  });

  const fileA = new File(["a"], "photo.png", { type: "image/png" });
  const fileB = new File(["b"], "spec.pdf", { type: "application/pdf" });
  await act(async () => {
    fileInputChange(container.querySelector('[data-testid="portal-attachment-input"]'), [fileA, fileB]);
  });

  let items = container.querySelectorAll('[data-testid="portal-attachment-item"]');
  expect(items.length).toBe(2);
  expect(container.textContent).toContain("photo.png");
  expect(container.textContent).toContain("spec.pdf");

  await click(container.querySelectorAll('[data-testid="portal-attachment-remove"]')[0]);
  items = container.querySelectorAll('[data-testid="portal-attachment-item"]');
  expect(items.length).toBe(1);
  expect(items[0].textContent).toContain("spec.pdf");

  await click(container.querySelector('[data-testid="portal-submit-button"]'));

  expect(mockPost).toHaveBeenCalledTimes(1);
  const [, form] = mockPost.mock.calls[0];
  const submittedFiles = form.getAll("attachments");
  expect(submittedFiles.length).toBe(1);
  expect(submittedFiles[0].name).toBe("spec.pdf");

  await act(async () => root.unmount());
});

test("submission payload includes manual item lines alongside Master items", async () => {
  mockContextAndItems({ previous: [CEMENT] });
  mockPost.mockResolvedValue({ data: { ok: true, request_number: "REQ-20260819-TEST" } });
  const { container, root } = await renderPage();

  await click(container.querySelector('[data-testid="portal-previous-item-chip"]'));
  await click(container.querySelector('[data-testid="portal-add-manual-item-button"]'));
  await act(async () => {
    setInputValue(container.querySelector('[data-testid="portal-manual-item-name"]'), "طلاء يدوي");
    setInputValue(container.querySelector('[data-testid="portal-manual-item-unit"]'), "لتر");
  });
  await click(container.querySelector('[data-testid="portal-manual-item-add-button"]'));
  await act(async () => {
    setInputValue(container.querySelector('[data-testid="portal-required-date"]'), "2027-01-01");
  });

  await click(container.querySelector('[data-testid="portal-submit-button"]'));

  const [, form] = mockPost.mock.calls[0];
  const payload = JSON.parse(form.get("payload"));
  expect(payload.items).toEqual([
    { item_id: "item-1", quantity: 1, note: "" },
    { product_name: "طلاء يدوي", unit: "لتر", quantity: 1, note: "" },
  ]);

  await act(async () => root.unmount());
});
