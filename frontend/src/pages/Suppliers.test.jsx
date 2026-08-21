import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Suppliers from "@/pages/Suppliers";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockGet = jest.fn();
const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }), { virtual: true });
jest.mock("@/lib/api", () => ({
  __esModule: true,
  fmtEGP: (value) => `${value || 0} ج.م`,
  errMsg: () => "خطأ",
  default: { get: (...args) => mockGet(...args), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

test("shows the compact supplier register and opens formal price history", async () => {
  mockGet.mockResolvedValue({ data: [{
    id: "supplier-1", code: "SUP-1", name: "مورد اختبار", specialty: "تشطيبات",
    group_name: "محلي", phone: "01000000000", city: "القاهرة",
    formal_po_total: 500, last_procurement_date: "2026-08-18", status: "نشط",
    direct_purchase_count: 2, direct_purchase_total: 200,
  }] });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Suppliers />);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  expect(mockGet).toHaveBeenCalledWith("/suppliers", { params: { include_procurement: true } });
  expect(container.textContent).toContain("كود المورد");
  expect(container.textContent).toContain("500 ج.م");
  expect(container.textContent).toContain("2026-08-18");
  expect(container.textContent).not.toContain("شراء مباشر");
  await act(async () => {
    container.querySelector('[data-testid="suppliers-actions"]').dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  await act(async () => document.querySelector('[data-testid="suppliers-row-action"]').click());
  expect(mockNavigate).toHaveBeenCalledWith("/price-history", { state: { supplier: "مورد اختبار" } });

  await act(async () => root.unmount());
  container.remove();
});
