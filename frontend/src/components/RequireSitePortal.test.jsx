import React, { act } from "react";
import { createRoot } from "react-dom/client";

import RequireSitePortal from "@/components/RequireSitePortal";

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
      <RequireSitePortal>
        <div data-testid="portal-screen">Portal</div>
      </RequireSitePortal>,
    );
  });
  return { container, root };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

test("auth still checking does not render the portal or redirect", async () => {
  mockAuthState = { status: "checking", user: null };
  const { container, root } = await renderGuard();

  expect(container.querySelector('[data-testid="portal-screen"]')).toBeNull();
  expect(container.querySelector('[data-testid="route-redirect"]')).toBeNull();

  await act(async () => root.unmount());
});

test("anonymous is redirected to /login", async () => {
  mockAuthState = { status: "anonymous", user: null };
  const { container, root } = await renderGuard();

  const redirect = container.querySelector('[data-testid="route-redirect"]');
  expect(redirect.dataset.to).toBe("/login");
  expect(container.querySelector('[data-testid="portal-screen"]')).toBeNull();

  await act(async () => root.unmount());
});

test("an authenticated site_portal user renders the portal screen", async () => {
  mockAuthState = {
    status: "authenticated",
    user: { account_type: "site_portal", role: "site_engineer" },
  };
  const { container, root } = await renderGuard();

  expect(container.querySelector('[data-testid="portal-screen"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="route-redirect"]')).toBeNull();

  await act(async () => root.unmount());
});

test("an ERP user cannot render the site portal screen and is redirected to /", async () => {
  mockAuthState = {
    status: "authenticated",
    user: { account_type: "erp", role: "admin" },
  };
  const { container, root } = await renderGuard();

  const redirect = container.querySelector('[data-testid="route-redirect"]');
  expect(redirect).not.toBeNull();
  expect(redirect.dataset.to).toBe("/");
  expect(container.querySelector('[data-testid="portal-screen"]')).toBeNull();

  await act(async () => root.unmount());
});
