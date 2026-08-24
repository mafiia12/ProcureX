import {
  BLANK_CLASSIFICATION,
  brandOptions,
  changeBrand,
  changeMainCategory,
  changeSubcategory,
  filterItems,
  itemProductName,
  mainCategoryOptions,
  selectItem,
  subcategoryOptions,
} from "@/lib/itemSelection";

const items = [
  { id: "1", name: "أسمنت قديم", product_name: "أسمنت", brand: "السويدي", code: "ITM1", main_category: "مواد", subcategory: "أسمنت", specifications: "مقاوم", unit: "شيكارة", last_price: 125, last_supplier: "مورد سابق", last_date: "2026-07-20" },
  { id: "2", name: "رمل", product_name: "رمل", brand: "محلي", code: "ITM2", main_category: "مواد", subcategory: "ركام", specifications: "ناعم", unit: "م³" },
  { id: "3", name: "جبس قديم", category: "تشطيبات", subcategory: "", brand: "", specs: "أبيض", unit: "شيكارة" },
];

test("main categories include modern and legacy item categories", () => {
  expect(mainCategoryOptions(items).map((option) => option.label)).toEqual([
    "تشطيبات", "مواد",
  ]);
});

test("subcategories are filtered by main category and retain blank legacy values", () => {
  expect(subcategoryOptions(items, "مواد").map((option) => option.label)).toEqual([
    "أسمنت", "ركام",
  ]);
  expect(subcategoryOptions(items, "تشطيبات")).toEqual([{
    value: BLANK_CLASSIFICATION,
    label: "بدون تصنيف فرعي",
  }]);
});

test("brands and products are filtered by all parent selections", () => {
  expect(brandOptions(items, "مواد", "ركام").map((option) => option.label)).toEqual(["محلي"]);
  expect(brandOptions(items, "تشطيبات", BLANK_CLASSIFICATION)).toEqual([{
    value: BLANK_CLASSIFICATION,
    label: "بدون علامة تجارية",
  }]);
  expect(filterItems(items, "مواد", "ركام", "محلي").map(itemProductName)).toEqual(["رمل"]);
  expect(filterItems(items, "تشطيبات", BLANK_CLASSIFICATION, BLANK_CLASSIFICATION).map(itemProductName)).toEqual(["جبس قديم"]);
});

test("selecting a product populates all master-data fields", () => {
  expect(selectItem({ quantity: "2" }, items[0])).toMatchObject({
    item_id: "1",
    item_code: "ITM1",
    product_name: "أسمنت",
    brand: "السويدي",
    main_category: "مواد",
    subcategory: "أسمنت",
    specifications: "مقاوم",
    unit: "شيكارة",
    last_historical_unit_price: 125,
    last_supplier_name: "مورد سابق",
    last_purchase_date: "2026-07-20",
    quantity: "2",
  });
});

test("changing either parent selection clears incompatible item state", () => {
  const selected = selectItem({ quantity: "2", unit_price: "100" }, items[0]);
  expect(changeMainCategory(selected, "تشطيبات")).toMatchObject({
    main_category: "تشطيبات", subcategory: "", brand: "", item_id: "", unit: "",
    last_purchase_date: "",
    quantity: "2", unit_price: "100",
  });
  expect(changeSubcategory(selected, "ركام")).toMatchObject({
    main_category: "مواد", subcategory: "ركام", brand: "", item_id: "", unit: "",
    last_purchase_date: "",
    quantity: "2", unit_price: "100",
  });
  expect(changeBrand(selected, "محلي")).toMatchObject({
    main_category: "مواد", subcategory: "أسمنت", brand: "محلي",
    item_id: "", product_name: "", item_code: "", specifications: "", unit: "",
    last_purchase_date: "",
    quantity: "2", unit_price: "100",
  });
});
