import React, { act } from "react";
import { createRoot } from "react-dom/client";

import Projects from "@/pages/Projects";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("react-router-dom", () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock("@/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    language: "ar",
    tr: (arabic) => arabic,
  }),
}));
jest.mock("@/components/CrudPage", () => (props) => {
  const { columns, paginated, listParams } = props;
  const row = { formal_po_value: 3461.76, paid_amount: 1200, outstanding_amount: 2261.76 };
  return <div
    data-testid="project-money-columns"
    data-paginated={paginated ? "true" : "false"}
    data-include-procurement={listParams?.include_procurement ? "true" : "false"}
  >
    {columns.filter((column) => column.render).map((column) => <span key={column.key}>{column.render(row)}</span>)}
  </div>;
});

test("project center financial columns use prefixed EGP and Western digits", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<Projects />));

  const financials = container.querySelector('[data-testid="project-money-columns"]');
  expect(financials.textContent).toContain("ج.م 3,461.76");
  expect(financials.textContent).toContain("ج.م 1,200.00");
  expect(financials.textContent).toContain("ج.م 2,261.76");
  expect(financials.textContent).not.toMatch(/[٠-٩]/);

  await act(async () => root.unmount());
  container.remove();
});

test("projects page through the server too, like Items/Suppliers/Customers", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<Projects />));

  const marker = container.querySelector('[data-testid="project-money-columns"]');
  expect(marker.getAttribute("data-paginated")).toBe("true");
  expect(marker.getAttribute("data-include-procurement")).toBe("true");

  await act(async () => root.unmount());
  container.remove();
});
