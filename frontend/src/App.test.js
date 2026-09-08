import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockDashboard = {
  total_purchases: 29947.5,
  purchase_count: 1,
  supplier_count: 17,
  item_count: 15,
  total_paid: 29947.5,
  total_outstanding: 0,
  project_count: 2,
  customer_count: 2,
  by_supplier: [{ name: "FOR BED", total: 29947.5 }],
  by_project: [{ name: "مشروع", total: 29947.5 }],
  monthly: [{ month: "2026-07", total: 29947.5 }],
  payment_status: [{ status: "مدفوع", count: 1, total: 29947.5 }],
};

const mockGet = jest.fn();

jest.mock("@/lib/api", () => ({
  __esModule: true,
  BACKEND_URL: "http://127.0.0.1:8000",
  fmt: (value) => String(value),
  fmtEGP: (value) => `${value} ج.م`,
  STATUS_STYLES: {},
  errMsg: () => "خطأ",
  default: {
    get: (...args) => mockGet(...args),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock("sonner", () => ({
  Toaster: () => null,
  toast: { error: jest.fn(), success: jest.fn() },
}));

jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    BrowserRouter: ({ children }) => <>{children}</>,
    Navigate: ({ to, replace }) => (
      <div
        data-testid="route-redirect"
        data-to={to}
        data-replace={String(Boolean(replace))}
      />
    ),
    useNavigate: () => jest.fn(),
    useLocation: () => ({ state: null }),
    Route: () => null,
    Routes: ({ children }) => {
      const outer = React.Children.toArray(children)[0];
      const routes = React.Children.toArray(outer.props.children);
      const selected = routes.find((route) => route.props.path === globalThis.location.pathname);
      if (!selected) return React.Children.toArray(children).find((route) => route.props.path === "*")?.props.element;
      return React.cloneElement(outer.props.element, { __outlet: selected?.props.element });
    },
  };
}, { virtual: true });

jest.mock("@/components/Layout", () => ({
  __esModule: true,
  default: ({ __outlet }) => <>{__outlet}</>,
}));

// This suite is about "does route X render page X", not auth guarding
// (that has its own dedicated tests: RequireErp.test.jsx,
// RequireSitePortal.test.jsx). Forward __outlet through the guard exactly
// like the real component forwards its children, so the existing
// per-route assertions below keep working unchanged.
jest.mock("@/components/RequireErp", () => ({
  __esModule: true,
  default: ({ children, __outlet }) => {
    const React = require("react");
    return React.cloneElement(children, { __outlet });
  },
}));

jest.mock("@/components/RequireSitePortal", () => ({
  __esModule: true,
  default: ({ children }) => children,
}));

jest.mock("@/components/RequireAdmin", () => ({
  __esModule: true,
  default: ({ children }) => children,
}));

jest.mock("recharts", () => {
  const Stub = ({ children }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Stub,
    BarChart: Stub,
    Bar: Stub,
    XAxis: Stub,
    YAxis: Stub,
    Tooltip: Stub,
    CartesianGrid: Stub,
    PieChart: Stub,
    Pie: Stub,
    Cell: Stub,
    Legend: Stub,
    AreaChart: Stub,
    Area: Stub,
  };
});

import App from "@/App";

beforeEach(() => {
  mockGet.mockImplementation((url) => {
    if (url === "/dashboard") return Promise.resolve({ data: mockDashboard });
    if (url === "/admin/whatsapp/settings") return Promise.resolve({ data: null });
    return Promise.resolve({ data: [] });
  });
});

const routes = [
  ["/", "dashboard-page"],
  ["/price-history", "price-history-page"],
  ["/payments", "payments-page"],
  ["/suppliers", "suppliers-page"],
  ["/items", "items-page"],
  ["/projects", "projects-page"],
  ["/customers", "customers-page"],
  ["/settings", "settings-page"],
];

describe.each(routes)("route %s", (path, testId) => {
  test(`renders ${testId}`, async () => {
    window.history.pushState({}, "", path);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(container.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });
});

test.each(["/construction-calculator", "/purchases", "/register", "/approved-items-draft"])("retired route %s redirects to the dashboard", async (path) => {
  window.history.pushState({}, "", path);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  const redirect = container.querySelector('[data-testid="route-redirect"]');
  expect(redirect).not.toBeNull();
  expect(redirect.dataset.to).toBe("/");
  expect(redirect.dataset.replace).toBe("true");
  expect(container.querySelector('[data-testid="construction-calculator-page"]'))
    .toBeNull();

  await act(async () => root.unmount());
  container.remove();
});
