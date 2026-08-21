import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PriceHistory from "./PriceHistory";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockGet = jest.fn();

jest.mock("react-router-dom", () => ({
  useLocation: () => ({ state: { supplier: "مورد أ" } }),
}), { virtual: true });
jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: { get: (...args) => mockGet(...args) },
  errMsg: () => "خطأ",
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));

test("renders formal quotation price intelligence without legacy purchase fields", async () => {
  mockGet.mockResolvedValue({ data: [{
    id: "line-1", date: "2026-08-20", item_code: "ITM-1", item_name: "دهان",
    supplier_id: "supplier-1", supplier: "مورد أ", project: "مشروع أ",
    quantity: 10, unit: "علبة", unit_price: 100, adjusted_unit_price: 107,
    discount_pct: 5, tax_pct: 12.6, currency: "EGP", availability: "available",
    rfq_number: "RFQ-000001", comparison_number: "CMP-000001",
  }] });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PriceHistory />);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  expect(mockGet).toHaveBeenCalledWith("/supplier-price-history", { params: { supplier: "مورد أ" } });
  expect(container.textContent).toContain("تاريخ أسعار الموردين");
  expect(container.textContent).toContain("RFQ-000001");
  expect(container.textContent).toContain("CMP-000001");
  expect(container.textContent).toContain("السعر المعدل");
  expect(container.textContent).not.toContain("رقم الفاتورة");

  await act(async () => root.unmount());
  container.remove();
});
