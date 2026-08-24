import React, { act } from "react";
import { createRoot } from "react-dom/client";

import RequireErp from "@/components/RequireErp";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mockAuthState;
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockAuthState,
}));

jest.mock("react-router-dom", () => ({
  Navigate: ({ to, replace }) => (
    <div data-testid="route-redirect" data-to={to} data-replace={String(Boolean(replace))} />
  ),
}), { virtual: true });

async function renderGuard() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <RequireErp>
        <div data-testid="erp-shell">ERP</div>
      </RequireErp>,
    );
  });
  return { container, root };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

test("auth still checking does not render the ERP shell or redirect", async () => {
  mockAuthState = { status: "checking", user: null };
  const { container, root } = await renderGuard();

  expect(container.querySelector('[data-testid="erp-shell"]')).toBeNull();
  expect(container.querySelector('[data-testid="route-redirect"]')).toBeNull();

  await act(async () => root.unmount());
});

test("anonymous is redirected to /login", async () => {
  mockAuthState = { status: "anonymous", user: null };
  const { container, root } = await renderGuard();

  const redirect = container.querySelector('[data-testid="route-redirect"]');
  expect(redirect).not.toBeNull();
  expect(redirect.dataset.to).toBe("/login");
  expect(container.querySelector('[data-testid="erp-shell"]')).toBeNull();

  await act(async () => root.unmount());
});

test("an authenticated ERP user renders the ERP shell", async () => {
  mockAuthState = {
    status: "authenticated",
    user: { account_type: "erp", role: "procurement_engineer" },
  };
  const { container, root } = await renderGuard();

  expect(container.querySelector('[data-testid="erp-shell"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="route-redirect"]')).toBeNull();

  await act(async () => root.unmount());
});

test("an authenticated site_portal user is redirected to the request portal, never the ERP shell", async () => {
  mockAuthState = {
    status: "authenticated",
    user: { account_type: "site_portal", role: "site_engineer" },
  };
  const { container, root } = await renderGuard();

  const redirect = container.querySelector('[data-testid="route-redirect"]');
  expect(redirect).not.toBeNull();
  expect(redirect.dataset.to).toBe("/request-purchase");
  expect(container.querySelector('[data-testid="erp-shell"]')).toBeNull();

  await act(async () => root.unmount());
});
