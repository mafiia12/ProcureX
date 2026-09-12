import React, { act } from "react";
import { createRoot } from "react-dom/client";

import CrudPage from "@/components/CrudPage";


globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
const mockToastError = jest.fn();
const mockToastSuccess = jest.fn();

jest.mock("@/lib/api", () => ({
  __esModule: true,
  errMsg: (error) => error?.response?.data?.detail || "خطأ غير متوقع",
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
    put: (...args) => mockPut(...args),
    delete: (...args) => mockDelete(...args),
  },
}));

jest.mock("sonner", () => ({
  toast: {
    error: (...args) => mockToastError(...args),
    success: (...args) => mockToastSuccess(...args),
  },
}));

const columns = [
  { key: "code", label: "الكود" },
  { key: "name", label: "اسم العميل" },
  { key: "phone", label: "الهاتف" },
];
const fields = [
  { key: "name", label: "اسم العميل", required: true },
  { key: "phone", label: "رقم الهاتف" },
  { key: "status", label: "الحالة", type: "select", options: ["نشط"], default: "نشط" },
];

async function renderPage(rows = []) {
  mockGet.mockResolvedValue({ data: rows });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <CrudPage
        title="عميل"
        endpoint="customers"
        testPrefix="uat"
        columns={columns}
        fields={fields}
      />,
    );
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

async function openMenu(element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = "";
});

test("create hides the code, focuses and highlights the actual required field, then saves", async () => {
  mockPost.mockResolvedValue({
    data: { id: "new", code: "CUS-000001", name: "عميل جديد", phone: "" },
  });
  const { container, root } = await renderPage();

  await click(container.querySelector('[data-testid="uat-add-button"]'));
  const nameInput = document.querySelector('[data-testid="uat-form-name"]');
  expect(nameInput).not.toBeNull();
  expect(document.querySelector('[data-testid="uat-form-code"]')).toBeNull();
  expect(document.activeElement).toBe(nameInput);

  await click(document.querySelector('[data-testid="uat-save-button"]'));
  expect(nameInput.getAttribute("aria-invalid")).toBe("true");
  expect(document.body.textContent).toContain("اسم العميل مطلوب");
  expect(document.querySelector('[data-testid="uat-form-status"]').getAttribute("aria-invalid"))
    .not.toBe("true");
  expect(mockPost).not.toHaveBeenCalled();

  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value",
    ).set;
    setter.call(nameInput, "عميل جديد");
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(document.querySelector('[data-testid="uat-save-button"]'));

  expect(mockPost).toHaveBeenCalledWith(
    "/customers",
    expect.not.objectContaining({ code: expect.anything() }),
  );
  expect(mockToastSuccess).toHaveBeenCalled();

  await act(async () => root.unmount());
});

test("list preserves a leading-zero phone and edit shows the generated code read-only", async () => {
  const row = {
    id: "customer-1",
    code: "CUS-000001",
    name: "عميل قائم",
    phone: "01001234567",
    status: "نشط",
  };
  const { container, root } = await renderPage([row]);

  expect(container.textContent).toContain("01001234567");
  await openMenu(container.querySelector('[data-testid="uat-actions"]'));
  await click(document.querySelector('[data-testid="uat-edit-button"]'));

  const codeInput = document.querySelector('[data-testid="uat-form-code"]');
  expect(codeInput).not.toBeNull();
  expect(codeInput.value).toBe("CUS-000001");
  expect(codeInput.readOnly).toBe(true);
  expect(document.querySelector('[data-testid="uat-form-phone"]').value).toBe("01001234567");

  await act(async () => root.unmount());
}, 15000);

function makeRow(index) {
  return { id: `customer-${index}`, code: `CUS-${index}`, name: `عميل ${index}`, phone: "" };
}

async function renderPaginatedPage() {
  // 5 total rows, pageSize 2 - page 1 and page 2 return distinct rows so a
  // real page turn is observable, not just a second call with the same
  // mocked data.
  mockGet.mockImplementation((url, config) => {
    const offset = config?.params?.offset ?? 0;
    if (offset === 0) {
      return Promise.resolve({
        data: [makeRow(1), makeRow(2)], headers: { "x-total-count": "5" },
      });
    }
    if (offset === 2) {
      return Promise.resolve({
        data: [makeRow(3), makeRow(4)], headers: { "x-total-count": "5" },
      });
    }
    return Promise.resolve({ data: [makeRow(5)], headers: { "x-total-count": "5" } });
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <CrudPage
        title="عميل"
        endpoint="customers"
        testPrefix="uat"
        columns={columns}
        fields={fields}
        paginated
        pageSize={2}
      />,
    );
    await Promise.resolve();
  });
  return { container, root };
}

test("paginated mode fetches one page at a time and turns pages on click", async () => {
  const { container, root } = await renderPaginatedPage();

  expect(mockGet).toHaveBeenCalledWith("/customers", { params: { limit: 2, offset: 0 } });
  expect(container.textContent).toContain("عميل 1");
  expect(container.textContent).toContain("عميل 2");
  expect(container.textContent).not.toContain("عميل 3");
  const pager = container.querySelector('[data-testid="uat-pager"]');
  expect(pager).not.toBeNull();
  expect(pager.textContent).toContain("5"); // total
  expect(container.querySelector('[data-testid="uat-pager-prev"]').disabled).toBe(true);
  expect(container.querySelector('[data-testid="uat-pager-next"]').disabled).toBe(false);

  await click(container.querySelector('[data-testid="uat-pager-next"]'));

  expect(mockGet).toHaveBeenCalledWith("/customers", { params: { limit: 2, offset: 2 } });
  expect(container.textContent).toContain("عميل 3");
  expect(container.textContent).toContain("عميل 4");
  expect(container.textContent).not.toContain("عميل 1");
  expect(container.querySelector('[data-testid="uat-pager-prev"]').disabled).toBe(false);

  await act(async () => root.unmount());
});

test("paginated mode doesn't also show the plain non-paginated totals line", async () => {
  const { container, root } = await renderPaginatedPage();

  // The pager bar already states the total ("5" here); the old
  // non-paginated "Total records: N" footer would otherwise duplicate it
  // (and show a misleading per-page count instead of the true total).
  expect(container.textContent).not.toContain("إجمالي السجلات");

  await act(async () => root.unmount());
});

test("searching in paginated mode falls back to a full fetch and paginates client-side", async () => {
  const { container, root } = await renderPaginatedPage();
  expect(mockGet).toHaveBeenCalledTimes(1);

  mockGet.mockResolvedValueOnce({
    data: [makeRow(1), makeRow(2), makeRow(3), makeRow(4), makeRow(5)],
  });
  const searchInput = container.querySelector('[data-testid="uat-search-input"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value",
    ).set;
    setter.call(searchInput, "عميل");
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
  });

  // The search-triggered fetch has no limit/offset - every match, not one page.
  expect(mockGet).toHaveBeenLastCalledWith("/customers");
  // All 5 rows matched "عميل", but pageSize=2 still caps what's rendered.
  expect(container.textContent).toContain("عميل 1");
  expect(container.textContent).toContain("عميل 2");
  expect(container.textContent).not.toContain("عميل 3");
  expect(container.querySelector('[data-testid="uat-pager"]').textContent).toContain("5");

  await act(async () => root.unmount());
});
