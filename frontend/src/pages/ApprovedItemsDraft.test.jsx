import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ApprovedItemsDraft from "@/pages/ApprovedItemsDraft";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockInternalGet = jest.fn();
jest.mock("@/lib/requestApi", () => ({
  internalRequestApi: { get: (...args) => mockInternalGet(...args) },
  requestError: () => "خطأ",
}));

const mockApiPatch = jest.fn();
jest.mock("@/lib/api", () => ({
  __esModule: true,
  errMsg: (error) => error?.response?.data?.detail || "خطأ",
  default: { patch: (...args) => mockApiPatch(...args) },
}));

const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
jest.mock("sonner", () => ({ toast: { error: (...a) => mockToastError(...a), success: (...a) => mockToastSuccess(...a) } }));

const items = [{
  request_id: "req-1", item_id: "item-1", request_number: "REQ-1", project_name: "مشروع أ",
  requester_name: "مهندس", product_name: "أسمنت", quantity: 5, unit: "شيكارة",
  approved_unit_price: 100, approved_price_note: "", review_status: "approved",
}];

beforeEach(() => {
  mockInternalGet.mockResolvedValue({ data: items });
  mockApiPatch.mockReset();
  mockToastSuccess.mockClear();
  mockToastError.mockClear();
});

test("saving an approved item's price goes through the authenticated API client, not the legacy internal-token client", async () => {
  mockApiPatch.mockResolvedValue({ data: {} });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ApprovedItemsDraft />);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("حفظ"));
  await act(async () => {
    saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });

  expect(mockApiPatch).toHaveBeenCalledWith(
    "/internal/incoming-purchase-requests/req-1/items/item-1/approved-price",
    expect.objectContaining({ unit_price: 100 }),
  );
  expect(mockToastSuccess).toHaveBeenCalledWith("تم حفظ سعر الصنف");
  expect(mockToastError).not.toHaveBeenCalled();

  await act(async () => root.unmount());
  container.remove();
});
