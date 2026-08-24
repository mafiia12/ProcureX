import { catalogKeys, messages } from "@/i18n/messages";

test("Arabic and English catalogs have exact key parity", () => {
  expect(catalogKeys(messages.ar).sort()).toEqual(catalogKeys(messages.en).sort());
});

test("catalog leaves no blank production messages", () => {
  for (const locale of Object.values(messages)) {
    for (const key of catalogKeys(locale)) {
      const value = key.split(".").reduce((object, part) => object[part], locale);
      expect(value.trim()).not.toBe("");
    }
  }
});

test("removed construction calculator has no navigation label", () => {
  expect(messages.ar.nav.construction).toBeUndefined();
  expect(messages.en.nav.construction).toBeUndefined();
  expect(messages.ar.construction).toBeUndefined();
  expect(messages.en.construction).toBeUndefined();
});
