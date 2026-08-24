import React, { act } from "react";
import { createRoot } from "react-dom/client";
import DocumentRequestForm from "@/components/DocumentRequestForm";
import { PreferencesProvider } from "@/contexts/PreferencesContext";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockGet = jest.fn();

jest.mock("@/lib/documentCaptureApi", () => ({
  publicDocumentApi: { get: (...args) => mockGet(...args), post: jest.fn() },
  documentError: () => "Request failed",
}));

test("camera/upload controls stay usable and hide technical confidence on public form", async () => {
  localStorage.setItem("procurex-language", "en");
  mockGet.mockResolvedValue({
    data: { available: false, status: "configuration_required", manual_entry_available: true },
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(<PreferencesProvider><DocumentRequestForm /></PreferencesProvider>);
    await Promise.resolve();
  });
  expect(container.querySelector('[data-testid="document-request-form"]')).not.toBeNull();
  expect(container.textContent).toContain("Manual entry remains available");
  expect(container.textContent.toLowerCase()).not.toContain("confidence");
  const inputs = container.querySelectorAll('input[type="file"]');
  expect(inputs).toHaveLength(2);
  expect(inputs[1].getAttribute("capture")).toBe("environment");
  await act(async () => root.unmount());
});
