import React, { act } from "react";
import { createRoot } from "react-dom/client";
import SettingsPage from "./SettingsPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockGet = jest.fn();
const mockPost = jest.fn(() => Promise.resolve({ data: { status: "ok" } }));

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: { get: (...args) => mockGet(...args), post: (...args) => mockPost(...args), put: jest.fn() },
  errMsg: () => "error",
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/components/PreferenceControls", () => () => <div>preferences</div>);
jest.mock("@/contexts/PreferencesContext", () => ({ usePreferences: () => ({ t: (key) => key }) }));

beforeEach(() => {
  mockGet.mockImplementation((url) => Promise.resolve({ data: url === "/settings" ? [] : {
    version: "0.3.0", mode: "development",
    database: { status: "healthy", integrity: "ok", foreign_key_violations: 0 },
    paths: { data: "C:/data", backups: "C:/backups", logs: "C:/logs" },
    last_backup: null,
  } }));
  mockPost.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: jest.fn(() => Promise.resolve()) },
  });
});

test("renders safe diagnostics and starts a verified backup", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SettingsPage />);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(container.textContent).toContain("0.3.0");
  await act(async () => {
    container.querySelector('[data-testid="create-system-backup"]').click();
    await Promise.resolve();
  });
  expect(mockPost).toHaveBeenCalledWith("/system/backup");
  await act(async () => {
    container.querySelector('[data-testid="copy-system-diagnostics"]').click();
    await Promise.resolve();
  });
  expect(navigator.clipboard.writeText).toHaveBeenCalled();
  const copied = navigator.clipboard.writeText.mock.calls[0][0];
  expect(copied).not.toContain("token");
  expect(copied).not.toContain("password");
  await act(async () => root.unmount());
  container.remove();
});
