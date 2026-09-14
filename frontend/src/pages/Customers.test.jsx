import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Customers from "@/pages/Customers";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockGet = jest.fn();

jest.mock("react-router-dom", () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock("@/lib/api", () => ({
  __esModule: true,
  fmtEGP: (value) => `${value || 0} ج.م`,
  errMsg: () => "خطأ",
  default: {
    get: (...args) => mockGet(...args),
    post: jest.fn(), put: jest.fn(), delete: jest.fn(),
  },
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

test("pages through customers via the server, like Items/Suppliers do", async () => {
  mockGet.mockResolvedValue({
    data: [{ id: "cus-1", code: "CUS-1", name: "عميل 1" }],
    headers: { "x-total-count": "3" },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Customers />);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  expect(mockGet).toHaveBeenCalledWith("/customers", { params: { limit: 50, offset: 0 } });
  const pager = container.querySelector('[data-testid="customers-pager"]');
  expect(pager).not.toBeNull();
  expect(pager.textContent).toContain("3");
  // Customers keeps the standard (non-compact) row density - only the pager
  // affordance is new, not a switch to Items/Suppliers' denser layout.
  expect(container.querySelector('[data-testid="customers-row"]').classList.contains("h-[34px]")).toBe(false);
  expect(container.textContent).not.toContain("إجمالي السجلات");

  await act(async () => root.unmount());
  container.remove();
});
