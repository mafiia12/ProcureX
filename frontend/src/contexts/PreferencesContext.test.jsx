import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PreferencesProvider, usePreferences } from "@/contexts/PreferencesContext";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const { language, direction, setLanguage, t } = usePreferences();
  return <button data-language={language} data-direction={direction} onClick={() => setLanguage("en")}>{t("nav.dashboard")}</button>;
}

test("language preference changes direction and persists per browser profile", async () => {
  localStorage.setItem("procurex-language", "ar");
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<PreferencesProvider><Probe /></PreferencesProvider>));
  const button = container.querySelector("button");
  expect(button.dataset.direction).toBe("rtl");
  await act(async () => button.click());
  expect(container.querySelector("button").dataset.direction).toBe("ltr");
  expect(document.documentElement.dir).toBe("ltr");
  expect(localStorage.getItem("procurex-language")).toBe("en");
  await act(async () => root.unmount());
});
