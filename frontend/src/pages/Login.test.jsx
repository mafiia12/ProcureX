import React, { act } from "react";
import { createRoot } from "react-dom/client";

import Login from "@/pages/Login";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}), { virtual: true });

const mockLogin = jest.fn();
const mockLogout = jest.fn();
let mockAuthState = { isAuthenticated: false, user: null };
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ ...mockAuthState, login: mockLogin, logout: mockLogout }),
}));

jest.mock("@/lib/api", () => ({
  errMsg: (error) => error?.response?.data?.detail || "خطأ غير متوقع",
}));

async function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, "value",
  ).set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthState = { isAuthenticated: false, user: null };
  document.body.innerHTML = "";
});

test("submitting valid ERP credentials logs in and navigates to the dashboard", async () => {
  mockLogin.mockResolvedValue({ account_type: "erp", role: "admin", username: "admin" });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Login />);
  });

  await setInputValue(container.querySelector('[data-testid="login-username-input"]'), "admin");
  await setInputValue(container.querySelector('[data-testid="login-password-input"]'), "secret123");
  await act(async () => {
    container.querySelector('[data-testid="login-submit-button"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockLogin).toHaveBeenCalledWith("admin", "secret123");
  expect(mockNavigate).toHaveBeenCalledWith("/");

  await act(async () => root.unmount());
});

test("a site portal account is routed to the request portal, not the ERP", async () => {
  mockLogin.mockResolvedValue({ account_type: "site_portal", role: "site_engineer", username: "engineer" });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Login />);
  });

  await setInputValue(container.querySelector('[data-testid="login-username-input"]'), "engineer");
  await setInputValue(container.querySelector('[data-testid="login-password-input"]'), "secret123");
  await act(async () => {
    container.querySelector('[data-testid="login-submit-button"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockLogout).not.toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith("/request-purchase");

  await act(async () => root.unmount());
});

test("invalid credentials show an inline error instead of navigating", async () => {
  mockLogin.mockRejectedValue({ response: { data: { detail: "بيانات خاطئة" } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Login />);
  });

  await setInputValue(container.querySelector('[data-testid="login-username-input"]'), "admin");
  await setInputValue(container.querySelector('[data-testid="login-password-input"]'), "wrong");
  await act(async () => {
    container.querySelector('[data-testid="login-submit-button"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockNavigate).not.toHaveBeenCalled();
  expect(container.querySelector('[data-testid="login-error"]').textContent).toBe("بيانات خاطئة");

  await act(async () => root.unmount());
});
