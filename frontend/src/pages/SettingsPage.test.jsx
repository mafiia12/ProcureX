import React, { act } from "react";
import { createRoot } from "react-dom/client";
import SettingsPage from "./SettingsPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockGet = jest.fn();
const mockPost = jest.fn(() => Promise.resolve({ data: { status: "ok" } }));
const mockPut = jest.fn(() => Promise.resolve({ data: {} }));

jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
}), { virtual: true });
jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: { get: (...args) => mockGet(...args), post: (...args) => mockPost(...args), put: (...args) => mockPut(...args) },
  errMsg: () => "error",
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/components/PreferenceControls", () => () => <div>preferences</div>);
jest.mock("@/contexts/PreferencesContext", () => ({ usePreferences: () => ({ t: (key) => key }) }));

const DIAGNOSTICS_RESPONSE = {
  version: "0.3.0", mode: "development",
  database: { status: "healthy", integrity: "ok", foreign_key_violations: 0 },
  paths: { data: "C:/data", backups: "C:/backups", logs: "C:/logs" },
  last_backup: null,
};

const WHATSAPP_NOT_CONFIGURED = {
  enabled: true,
  setup_categories: [
    { key: "meta_credentials", label_ar: "بيانات اعتماد Meta", ready: false },
    { key: "public_webhook", label_ar: "الاتصال بالويب هوك العام", ready: false },
  ],
  connection_status: "not_configured", connection_error: "", last_checked_at: "",
  business_number: "", business_name: "",
  webhook_status: "waiting",
  webhook_url: "https://example.trycloudflare.com/api/integrations/whatsapp/webhook",
  webhook_url_configured: true,
  local_backend_url: "http://127.0.0.1:8000/api/integrations/whatsapp/webhook",
  engineers: { with_phone: 0, total: 0 },
};

const WHATSAPP_CONNECTED = {
  enabled: true,
  setup_categories: [
    { key: "meta_credentials", label_ar: "بيانات اعتماد Meta", ready: true },
    { key: "public_webhook", label_ar: "الاتصال بالويب هوك العام", ready: true },
  ],
  connection_status: "connected", connection_error: "", last_checked_at: "2026-08-29T00:00:00Z",
  business_number: "+201012345678", business_name: "RE DECOR & MORE",
  webhook_status: "connected",
  webhook_url: "https://example.trycloudflare.com/api/integrations/whatsapp/webhook",
  webhook_url_configured: true,
  local_backend_url: "http://127.0.0.1:8000/api/integrations/whatsapp/webhook",
  engineers: { with_phone: 8, total: 10 },
};

const WHATSAPP_CONNECTED_NO_PUBLIC_URL = {
  ...WHATSAPP_CONNECTED,
  webhook_url: "", webhook_url_configured: false, webhook_status: "waiting",
  setup_categories: [
    { key: "meta_credentials", label_ar: "بيانات اعتماد Meta", ready: true },
    { key: "public_webhook", label_ar: "الاتصال بالويب هوك العام", ready: false },
  ],
};

let whatsappResponse = WHATSAPP_NOT_CONFIGURED;

beforeEach(() => {
  whatsappResponse = WHATSAPP_NOT_CONFIGURED;
  mockGet.mockImplementation((url) => {
    if (url === "/settings") return Promise.resolve({ data: [] });
    if (url === "/admin/whatsapp/settings") return Promise.resolve({ data: whatsappResponse });
    return Promise.resolve({ data: DIAGNOSTICS_RESPONSE });
  });
  mockPost.mockClear();
  mockPut.mockClear();
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

test("shows the setup checklist when Meta credentials are not configured", async () => {
  whatsappResponse = WHATSAPP_NOT_CONFIGURED;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SettingsPage />);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  const section = container.querySelector('[data-testid="whatsapp-settings-section"]');
  expect(section).not.toBeNull();
  expect(container.querySelector('[data-testid="whatsapp-setup-checklist"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="whatsapp-enabled-switch"]')).toBeNull();
  expect(container.querySelector('[data-testid="whatsapp-test-connection"]')).toBeNull();

  await act(async () => root.unmount());
  container.remove();
});

test("connected WhatsApp settings show the business number, engineer count, and toggle/test actions", async () => {
  whatsappResponse = WHATSAPP_CONNECTED;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SettingsPage />);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  expect(container.querySelector('[data-testid="whatsapp-setup-checklist"]')).toBeNull();
  expect(container.textContent).toContain("+201012345678");
  expect(container.textContent).toContain("8");
  expect(container.textContent).toContain("10");
  // secrets must never render anywhere on this screen
  expect(container.textContent).not.toMatch(/WHATSAPP_ACCESS_TOKEN|WHATSAPP_APP_SECRET|WHATSAPP_VERIFY_TOKEN/);

  await act(async () => {
    container.querySelector('[data-testid="whatsapp-test-connection"]').click();
    await Promise.resolve();
  });
  expect(mockPost).toHaveBeenCalledWith("/admin/whatsapp/settings/test-connection");

  const toggle = container.querySelector('[data-testid="whatsapp-enabled-switch"]');
  expect(toggle).not.toBeNull();
  await act(async () => {
    toggle.click();
    await Promise.resolve();
  });
  expect(mockPut).toHaveBeenCalledWith("/admin/whatsapp/settings", { enabled: false });

  await act(async () => root.unmount());
  container.remove();
});

test("never shows a localhost URL as the Meta webhook when PUBLIC_BASE_URL is not configured", async () => {
  whatsappResponse = WHATSAPP_CONNECTED_NO_PUBLIC_URL;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SettingsPage />);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  const missingNotice = container.querySelector('[data-testid="whatsapp-webhook-url-missing"]');
  expect(missingNotice).not.toBeNull();
  expect(missingNotice.textContent).toMatch(/غير مهيأ|not configured/i);
  // the local diagnostic URL may appear, but never as if it were the Meta callback
  expect(container.textContent).not.toContain("https://example.trycloudflare.com");
  // no Copy button (within the WhatsApp section) when there's no public URL to copy
  const whatsappSection = container.querySelector('[data-testid="whatsapp-settings-section"]');
  const copyButtons = Array.from(whatsappSection.querySelectorAll("button")).filter((b) => /نسخ|copy/i.test(b.textContent));
  expect(copyButtons.length).toBe(0);

  await act(async () => root.unmount());
  container.remove();
});
