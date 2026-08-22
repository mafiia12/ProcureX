import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Layout from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("@/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ t: (key) => key }),
}));

const mockLogout = jest.fn();
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: jest.fn(() => ({ user: null })),
}));

jest.mock("@/components/PreferenceControls", () => () => null);

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  NavLink: ({ children, to }) => <a href={to}>{children}</a>,
  Outlet: () => <div data-testid="dashboard-content" />,
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => mockNavigate,
}), { virtual: true });

// CRA's test environment resets mock implementations before every test, so
// the factory's default return value above only applies once; restore it
// explicitly for tests that don't set their own useAuth() return value.
beforeEach(() => {
  localStorage.removeItem("procurex-sidebar-collapsed");
  useAuth.mockReturnValue({ user: null, logout: mockLogout });
  mockLogout.mockClear();
  mockNavigate.mockClear();
});

test("main sidebar can be collapsed and expanded from the dashboard header", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<Layout />);
  });

  const sidebar = container.querySelector('[data-testid="sidebar"]');
  const toggle = container.querySelector('[data-testid="sidebar-toggle"]');
  expect(sidebar.dataset.collapsed).toBe("false");
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector('[href="/"]').textContent).toContain("nav.dashboard");

  await act(async () => {
    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  expect(sidebar.dataset.collapsed).toBe("true");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector('[href="/"]').textContent).not.toContain("nav.dashboard");
  expect(localStorage.getItem("procurex-sidebar-collapsed")).toBe("true");

  await act(async () => {
    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  expect(sidebar.dataset.collapsed).toBe("false");
  expect(toggle.getAttribute("aria-expanded")).toBe("true");

  await act(async () => root.unmount());
  container.remove();
});

test("shared navigation does not expose the removed construction calculator", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<Layout />);
  });

  expect(container.querySelector('[href="/construction-calculator"]')).toBeNull();
  expect(container.textContent).not.toContain("nav.construction");
  expect(container.querySelector('[data-testid="dashboard-content"]')).not.toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("user management navigation is hidden for a non-admin user", async () => {
  useAuth.mockReturnValue({
    user: { account_type: "erp", role: "procurement_engineer" },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<Layout />);
  });

  expect(container.querySelector('[href="/admin/users"]')).toBeNull();

  await act(async () => root.unmount());
  container.remove();
  useAuth.mockReturnValue({ user: null });
});

test("sidebar shows the logged-in ERP user's display name and Arabic role label", async () => {
  useAuth.mockReturnValue({
    user: { username: "ahmed.m", display_name: "أحمد محمد", role: "procurement_engineer", account_type: "erp" },
    logout: mockLogout,
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => { root.render(<Layout />); });

  expect(container.querySelector('[data-testid="sidebar-user-name"]').textContent).toBe("أحمد محمد");
  expect(container.querySelector('[data-testid="sidebar-user-role"]').textContent).toBe("مهندس المشتريات");

  await act(async () => root.unmount());
  container.remove();
});

test("sidebar falls back to username when no display name is set", async () => {
  useAuth.mockReturnValue({
    user: { username: "resp1", display_name: "", role: "procurement_responsible", account_type: "erp" },
    logout: mockLogout,
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => { root.render(<Layout />); });

  expect(container.querySelector('[data-testid="sidebar-user-name"]').textContent).toBe("resp1");
  expect(container.querySelector('[data-testid="sidebar-user-role"]').textContent).toBe("مسؤول المشتريات");

  await act(async () => root.unmount());
  container.remove();
});

test("logout button is visible and clicking it clears the session via AuthContext and redirects to /login", async () => {
  useAuth.mockReturnValue({
    user: { username: "mgr1", display_name: "مدير تجاري", role: "commercial_manager", account_type: "erp" },
    logout: mockLogout,
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => { root.render(<Layout />); });

  const logoutButton = container.querySelector('[data-testid="sidebar-logout"]');
  expect(logoutButton).not.toBeNull();
  expect(logoutButton.textContent).toContain("تسجيل الخروج");

  await act(async () => { logoutButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

  expect(mockLogout).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });

  await act(async () => root.unmount());
  container.remove();
});

test("site portal accounts never get the ERP sidebar user block", async () => {
  useAuth.mockReturnValue({
    user: { username: "portal1", role: "site_portal", account_type: "site_portal" },
    logout: mockLogout,
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => { root.render(<Layout />); });

  expect(container.querySelector('[data-testid="sidebar-user"]')).toBeNull();
  expect(container.querySelector('[data-testid="sidebar-logout"]')).toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("no user block renders while anonymous", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => { root.render(<Layout />); });

  expect(container.querySelector('[data-testid="sidebar-user"]')).toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("legacy purchase, register, price-history, and customers links are absent from formal navigation", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<Layout />);
  });

  for (const path of ["/purchases", "/register", "/price-history", "/customers", "/approved-items-draft"]) {
    expect(container.querySelector(`[href="${path}"]`)).toBeNull();
  }

  await act(async () => root.unmount());
  container.remove();
});

test("formal operations, master data, and admin navigation remain present", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<Layout />);
  });

  for (const path of [
    "/", "/incoming-requests", "/supplier-price-comparison", "/approvals",
    "/purchase-orders", "/payments", "/suppliers", "/items", "/projects",
  ]) {
    expect(container.querySelector(`[href="${path}"]`)).not.toBeNull();
  }

  await act(async () => root.unmount());
  container.remove();
});

test("user management navigation is shown for an admin user", async () => {
  useAuth.mockReturnValue({
    user: { account_type: "erp", role: "admin" },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<Layout />);
  });

  expect(container.querySelector('[href="/admin/users"]')).not.toBeNull();

  await act(async () => root.unmount());
  container.remove();
  useAuth.mockReturnValue({ user: null });
});
