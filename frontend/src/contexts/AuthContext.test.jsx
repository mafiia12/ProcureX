import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { AuthProvider, useAuth } from "@/contexts/AuthContext";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
  },
}));

const TOKEN_KEY = "procurex-auth-token";

function Probe() {
  const { status, user, login, logout } = useAuth();
  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="user">{user ? user.username : ""}</div>
      <button data-testid="do-login" onClick={() => login("admin", "secret")}>login</button>
      <button data-testid="do-logout" onClick={() => logout()}>logout</button>
    </div>
  );
}

async function renderProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<AuthProvider><Probe /></AuthProvider>);
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = "";
});

test("with no stored token, status is anonymous immediately (no /auth/me call)", async () => {
  const { container, root } = await renderProbe();

  expect(container.querySelector('[data-testid="status"]').textContent).toBe("anonymous");
  expect(mockGet).not.toHaveBeenCalled();

  await act(async () => root.unmount());
});

test("a stored valid token is restored via /auth/me", async () => {
  window.localStorage.setItem(TOKEN_KEY, "a-valid-token");
  mockGet.mockResolvedValue({ data: { id: "u1", username: "admin", account_type: "erp", role: "admin" } });

  const { container, root } = await renderProbe();

  expect(mockGet).toHaveBeenCalledWith("/auth/me");
  expect(container.querySelector('[data-testid="status"]').textContent).toBe("authenticated");
  expect(container.querySelector('[data-testid="user"]').textContent).toBe("admin");

  await act(async () => root.unmount());
});

test("an invalid or expired stored token is cleared and the user is returned to anonymous", async () => {
  window.localStorage.setItem(TOKEN_KEY, "an-expired-token");
  mockGet.mockRejectedValue({ response: { status: 401 } });

  const { container, root } = await renderProbe();

  expect(container.querySelector('[data-testid="status"]').textContent).toBe("anonymous");
  expect(container.querySelector('[data-testid="user"]').textContent).toBe("");
  expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();

  await act(async () => root.unmount());
});

test("login stores a token and sets the authenticated user", async () => {
  mockPost.mockResolvedValue({
    data: { access_token: "fresh-token", user: { id: "u1", username: "admin", account_type: "erp", role: "admin" } },
  });
  const { container, root } = await renderProbe();

  await act(async () => {
    container.querySelector('[data-testid="do-login"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(window.localStorage.getItem(TOKEN_KEY)).toBe("fresh-token");
  expect(container.querySelector('[data-testid="status"]').textContent).toBe("authenticated");

  await act(async () => root.unmount());
});

test("logout clears the token and returns to the anonymous state", async () => {
  window.localStorage.setItem(TOKEN_KEY, "a-valid-token");
  mockGet.mockResolvedValue({ data: { id: "u1", username: "admin", account_type: "erp", role: "admin" } });
  const { container, root } = await renderProbe();
  expect(container.querySelector('[data-testid="status"]').textContent).toBe("authenticated");

  await act(async () => {
    container.querySelector('[data-testid="do-logout"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  expect(container.querySelector('[data-testid="status"]').textContent).toBe("anonymous");
  expect(container.querySelector('[data-testid="user"]').textContent).toBe("");

  await act(async () => root.unmount());
});
