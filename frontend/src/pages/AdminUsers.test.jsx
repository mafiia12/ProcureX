import React, { act } from "react";
import { createRoot } from "react-dom/client";

import AdminUsers from "@/pages/AdminUsers";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();

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
  toast: { error: jest.fn(), success: jest.fn() },
}));

// The real Radix Select needs pointer-capture APIs jsdom doesn't implement;
// every other page in this repo swaps it for a plain <select> in tests too
// (see Payments.test.jsx) rather than polyfilling Radix internals.
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

const PROJECT_A = { id: "proj-a", code: "PRJ-000001", name: "مشروع أ" };
const PROJECT_B = { id: "proj-b", code: "PRJ-000002", name: "مشروع ب" };

const ERP_USER = {
  id: "user-1", username: "erp.one", display_name: "مستخدم داخلي",
  account_type: "erp", role: "procurement_engineer", active: true,
  assigned_projects: [], created_at: "2026-01-01", updated_at: "2026-01-01",
};
const PORTAL_USER = {
  id: "user-2", username: "site.one", display_name: "مهندس موقع",
  account_type: "site_portal", role: "site_engineer", active: true,
  assigned_projects: [PROJECT_A], created_at: "2026-01-01", updated_at: "2026-01-01",
};

async function renderPage(users = [ERP_USER, PORTAL_USER]) {
  mockGet.mockImplementation((url) => {
    if (url === "/admin/users") return Promise.resolve({ data: users });
    if (url === "/projects") return Promise.resolve({ data: [PROJECT_A, PROJECT_B] });
    return Promise.resolve({ data: [] });
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<AdminUsers />);
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
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, "value",
  ).set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = "";
});

test("admin users page loads and renders the user list", async () => {
  const { container, root } = await renderPage();

  expect(container.querySelector('[data-testid="admin-users-page"]')).not.toBeNull();
  expect(mockGet).toHaveBeenCalledWith("/admin/users");
  const rows = container.querySelectorAll('[data-testid="admin-users-row"]');
  expect(rows.length).toBe(2);
  expect(container.textContent).toContain("مستخدم داخلي");
  expect(container.textContent).toContain("مهندس موقع");
  // Site portal row shows its assigned project by name.
  expect(container.textContent).toContain("مشروع أ");

  await act(async () => root.unmount());
});

test("create ERP user submits with the selected role and no project payload", async () => {
  mockPost.mockResolvedValue({ data: { ...ERP_USER, id: "new-erp" } });
  const { container, root } = await renderPage([]);

  await click(container.querySelector('[data-testid="admin-users-add-button"]'));
  setInputValue(document.querySelector('[data-testid="admin-users-form-display-name"]'), "مستخدم جديد");
  setInputValue(document.querySelector('[data-testid="admin-users-form-username"]'), "new.user");
  setInputValue(document.querySelector('[data-testid="admin-users-form-password"]'), "StrongPass123!");

  // Default account type is already "erp"; the role selector must be visible.
  const roleSelect = document.querySelector('[data-testid="admin-users-form-role"]');
  expect(roleSelect).not.toBeNull();
  expect(document.querySelector('[data-testid="admin-users-form-projects"]')).toBeNull();

  await act(async () => {
    roleSelect.value = "commercial_manager";
    roleSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await click(document.querySelector('[data-testid="admin-users-save-button"]'));

  expect(mockPost).toHaveBeenCalledWith("/admin/users", expect.objectContaining({
    username: "new.user",
    display_name: "مستخدم جديد",
    password: "StrongPass123!",
    account_type: "erp",
    role: "commercial_manager",
  }));
  expect(mockPost.mock.calls[0][1]).not.toHaveProperty("project_ids");

  await act(async () => root.unmount());
});

test("switching account type to site portal hides the role field and shows project selection", async () => {
  const { container, root } = await renderPage([]);

  await click(container.querySelector('[data-testid="admin-users-add-button"]'));
  expect(document.querySelector('[data-testid="admin-users-form-role"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="admin-users-form-projects"]')).toBeNull();

  const accountTypeSelect = document.querySelector(
    '[data-testid="admin-users-form-account-type"]',
  );
  await act(async () => {
    accountTypeSelect.value = "site_portal";
    accountTypeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });

  expect(document.querySelector('[data-testid="admin-users-form-role"]')).toBeNull();
  const projectsBox = document.querySelector('[data-testid="admin-users-form-projects"]');
  expect(projectsBox).not.toBeNull();
  expect(projectsBox.textContent).toContain("مشروع أ");
  expect(projectsBox.textContent).toContain("مشروع ب");

  await act(async () => root.unmount());
});

test("create site portal user submits selected project ids and no role", async () => {
  mockPost.mockResolvedValue({ data: PORTAL_USER });
  const { container, root } = await renderPage([]);

  await click(container.querySelector('[data-testid="admin-users-add-button"]'));
  setInputValue(document.querySelector('[data-testid="admin-users-form-display-name"]'), "مهندس جديد");
  setInputValue(document.querySelector('[data-testid="admin-users-form-username"]'), "new.engineer");
  setInputValue(document.querySelector('[data-testid="admin-users-form-password"]'), "StrongPass123!");

  const accountTypeSelect = document.querySelector(
    '[data-testid="admin-users-form-account-type"]',
  );
  await act(async () => {
    accountTypeSelect.value = "site_portal";
    accountTypeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const checkbox = document.querySelector('[data-testid="admin-users-form-projects"] input[type="checkbox"]');
  await act(async () => {
    checkbox.click();
  });

  await click(document.querySelector('[data-testid="admin-users-save-button"]'));

  expect(mockPost).toHaveBeenCalledWith("/admin/users", expect.objectContaining({
    account_type: "site_portal",
    project_ids: [PROJECT_A.id],
  }));
  expect(mockPost.mock.calls[0][1]).not.toHaveProperty("role");

  await act(async () => root.unmount());
});

test("create site portal user includes the WhatsApp phone number when provided", async () => {
  mockPost.mockResolvedValue({ data: PORTAL_USER });
  const { container, root } = await renderPage([]);

  await click(container.querySelector('[data-testid="admin-users-add-button"]'));
  setInputValue(document.querySelector('[data-testid="admin-users-form-display-name"]'), "مهندس جديد");
  setInputValue(document.querySelector('[data-testid="admin-users-form-username"]'), "new.engineer");
  setInputValue(document.querySelector('[data-testid="admin-users-form-password"]'), "StrongPass123!");

  const accountTypeSelect = document.querySelector('[data-testid="admin-users-form-account-type"]');
  await act(async () => {
    accountTypeSelect.value = "site_portal";
    accountTypeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });

  setInputValue(document.querySelector('[data-testid="admin-users-form-phone"]'), "+201012345678");
  await click(document.querySelector('[data-testid="admin-users-save-button"]'));

  expect(mockPost).toHaveBeenCalledWith("/admin/users", expect.objectContaining({
    account_type: "site_portal",
    phone: "+201012345678",
  }));

  await act(async () => root.unmount());
});

test("the initial password never appears anywhere in the rendered page after submit", async () => {
  mockPost.mockResolvedValue({ data: { ...ERP_USER, id: "new-erp" } });
  const { container, root } = await renderPage([]);

  await click(container.querySelector('[data-testid="admin-users-add-button"]'));
  setInputValue(document.querySelector('[data-testid="admin-users-form-display-name"]'), "مستخدم جديد");
  setInputValue(document.querySelector('[data-testid="admin-users-form-username"]'), "new.user");
  setInputValue(document.querySelector('[data-testid="admin-users-form-password"]'), "SuperSecretValue1!");
  await click(document.querySelector('[data-testid="admin-users-save-button"]'));

  expect(document.body.textContent).not.toContain("SuperSecretValue1!");
  expect(document.body.innerHTML).not.toContain("SuperSecretValue1!");

  await act(async () => root.unmount());
});

test("reset password dialog never renders the previous password and clears its own field", async () => {
  const { container, root } = await renderPage();
  mockPost.mockResolvedValue({ data: { ok: true } });

  const resetButtons = container.querySelectorAll('button[title="إعادة تعيين كلمة المرور"]');
  await click(resetButtons[0]);
  const input = document.querySelector('[data-testid="admin-users-reset-password-input"]');
  expect(input.value).toBe("");
  setInputValue(input, "BrandNewSecret1!");

  await click(document.querySelector('[data-testid="admin-users-reset-password-submit"]'));

  expect(mockPost).toHaveBeenCalledWith(
    `/admin/users/${ERP_USER.id}/reset-password`,
    { new_password: "BrandNewSecret1!" },
  );
  expect(document.body.textContent).not.toContain("BrandNewSecret1!");

  await act(async () => root.unmount());
});
