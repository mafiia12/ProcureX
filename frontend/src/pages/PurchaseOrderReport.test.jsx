import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PurchaseOrderReport from "@/pages/PurchaseOrderReport";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mockCurrentAudience = "admin";
const mockGet = jest.fn();

jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
  useParams: () => ({ purchaseOrderId: "po-1", audience: mockCurrentAudience }),
}), { virtual: true });
jest.mock("@/lib/api", () => ({
  __esModule: true,
  fmtEGP: (value) => `${Number(value || 0).toFixed(2)} ج.م`,
  errMsg: () => "خطأ",
  default: { get: (...args) => mockGet(...args) },
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const base = {
  title: "تقرير تنفيذ أمر شراء", status: "قيد التوريد", project_name: "مشروع أ",
  supplier_name: "مورد أ", po_number: "PO-1", request_number: "REQ-1",
  comparison_number: "CMP-1", approval_number: "APR-1", execution_date: "2026-08-17",
  generated_at: "2026-08-17T12:00:00Z", notes: "استلام بالموقع",
};
const admin = {
  ...base, customer_name: "عميل أ", prepared_by: "مسؤول أ", payment_terms: "نقدي", delivery_days: 4,
  items: [{ position: 1, product_name: "أسمنت", quantity: 10, unit: "شيكارة", unit_price: 100,
    discount_pct: 0, vat_pct: 14, shipping_cost: 25, line_total: 1165 }],
  totals: { subtotal: 1000, discount_total: 0, vat_total: 140, shipping_total: 25, other_total: 0, final_total: 1165 },
};
const site = {
  ...base, title: "إشعار توريد للموقع", delivery_reference: "PO-1",
  receiving_instruction: "راجع الأصناف والكميات عند الاستلام.",
  items: [{ position: 1, product_name: "أسمنت", quantity: 10, unit: "شيكارة", specifications: "رتبة 42.5" }],
};

async function renderReport(audience) {
  mockCurrentAudience = audience;
  mockGet.mockResolvedValue({ data: audience === "site" ? site : admin });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PurchaseOrderReport />);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return { container, root };
}

test("admin report shows commercial values and print/share limitations", async () => {
  const { container, root } = await renderReport("admin");
  expect(mockGet).toHaveBeenLastCalledWith("/purchase-orders/po-1/reports/admin");
  expect(container.textContent).toContain("سعر الوحدة");
  expect(container.textContent).toContain("الإجمالي النهائي");
  expect(container.textContent).toContain("لا يوجد رابط عام قابل للمشاركة حاليًا");
  await act(async () => root.unmount());
  container.remove();
});

test("site report contains operational data only and no commercial labels", async () => {
  const { container, root } = await renderReport("site");
  expect(mockGet).toHaveBeenLastCalledWith("/purchase-orders/po-1/reports/site");
  expect(container.textContent).toContain("راجع الأصناف والكميات عند الاستلام");
  expect(container.textContent).not.toContain("سعر الوحدة");
  expect(container.textContent).not.toContain("الإجمالي النهائي");
  expect(container.textContent).not.toContain("الخصم");
  expect(container.textContent).not.toContain("الضريبة");
  await act(async () => root.unmount());
  container.remove();
});
