import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import Purchases from "./Purchases";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockGet = jest.fn(() => Promise.resolve({ data: [] }));
const mockPost = jest.fn();

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: { get: (...args) => mockGet(...args), post: (...args) => mockPost(...args) },
  fmtEGP: (value) => `${Number(value).toFixed(2)} EGP`,
  errMsg: () => "error",
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ language: "ar", direction: "rtl" }),
}));

beforeEach(() => {
  mockGet.mockImplementation(() => Promise.resolve({ data: [] }));
  mockPost.mockReset();
});

test("blocks an incomplete purchase before any save request", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Purchases />);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await act(async () => container.querySelector('[data-testid="save-purchase-button"]').click());
  expect(mockPost).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("من فضلك أدخل رقم الفاتورة");
  await act(async () => root.unmount());
  container.remove();
});
