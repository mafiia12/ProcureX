import fs from "fs";
import path from "path";

test("theme and direction are applied in HTML before the React bundle", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../public/index.html"), "utf8");
  const rootPosition = html.indexOf('<div id="root"></div>');
  expect(html.indexOf('localStorage.getItem("procurex-theme")')).toBeGreaterThan(0);
  expect(html.indexOf('localStorage.getItem("procurex-language")')).toBeGreaterThan(0);
  expect(html.indexOf("document.documentElement.className")).toBeLessThan(rootPosition);
  expect(html.indexOf("document.documentElement.dir")).toBeLessThan(rootPosition);
});

test("print CSS forces a light white-paper palette", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "index.css"), "utf8");
  expect(css).toContain("html.dark { color-scheme: light !important; }");
  expect(css).toContain("background: #fff !important;");
});
