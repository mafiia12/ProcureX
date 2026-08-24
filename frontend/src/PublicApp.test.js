import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("sonner", () => ({ Toaster: () => null }));
jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    BrowserRouter: ({ children }) => <>{children}</>,
    Navigate: ({ to }) => {
      globalThis.history.replaceState({}, "", to);
      return null;
    },
    Route: () => null,
    Routes: ({ children }) => {
      const routes = React.Children.toArray(children);
      const selected = routes.find((route) => route.props.path === globalThis.location.pathname)
        || routes.find((route) => route.props.path === "*");
      return selected?.props.element || null;
    },
  };
}, { virtual: true });
jest.mock("@/pages/PublicPurchaseRequest", () => ({
  __esModule: true,
  default: () => <main data-testid="public-only-page">public request</main>,
}));

import PublicApp from "@/PublicApp";

test("public application renders only the purchase request route", async () => {
  window.history.pushState({}, "", "/request-purchase");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<PublicApp />));
  expect(container.querySelector('[data-testid="public-only-page"]')).not.toBeNull();
  expect(window.location.pathname).toBe("/request-purchase");
  await act(async () => root.unmount());
  container.remove();
});
