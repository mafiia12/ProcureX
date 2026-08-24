export const BLANK_CLASSIFICATION = "__blank_classification__";

export const itemMainCategory = (item) => item?.main_category || item?.category || "";
export const itemProductName = (item) => item?.product_name || item?.name || "";

const classificationValue = (value) => (
  value === BLANK_CLASSIFICATION ? "" : String(value || "")
);

const selectionValue = (value) => value || BLANK_CLASSIFICATION;

const uniqueSorted = (values) => [...new Set(values)].sort((a, b) => (
  a.localeCompare(b, "ar", { sensitivity: "base" })
));

export const mainCategoryOptions = (items) => uniqueSorted(
  items.map(itemMainCategory)
).map((category) => ({
  value: selectionValue(category),
  label: category || "بدون تصنيف رئيسي",
}));

export const subcategoryOptions = (items, mainCategory) => {
  if (!mainCategory) return [];
  const selectedMain = classificationValue(mainCategory);
  return uniqueSorted(
    items
      .filter((item) => itemMainCategory(item) === selectedMain)
      .map((item) => item.subcategory || "")
  ).map((subcategory) => ({
    value: selectionValue(subcategory),
    label: subcategory || "بدون تصنيف فرعي",
  }));
};

export const brandOptions = (items, mainCategory, subcategory) => {
  if (!mainCategory || !subcategory) return [];
  const selectedMain = classificationValue(mainCategory);
  const selectedSubcategory = classificationValue(subcategory);
  return uniqueSorted(
    items
      .filter((item) => (
        itemMainCategory(item) === selectedMain
        && (item.subcategory || "") === selectedSubcategory
      ))
      .map((item) => item.brand || "")
  ).map((brand) => ({
    value: selectionValue(brand),
    label: brand || "بدون علامة تجارية",
  }));
};

export const filterItems = (items, mainCategory, subcategory, brand) => {
  if (!mainCategory || !subcategory || !brand) return [];
  const selectedMain = classificationValue(mainCategory);
  const selectedSubcategory = classificationValue(subcategory);
  const selectedBrand = classificationValue(brand);
  return items.filter((item) => (
    itemMainCategory(item) === selectedMain
    && (item.subcategory || "") === selectedSubcategory
    && (item.brand || "") === selectedBrand
  ));
};

export const changeMainCategory = (row, mainCategory) => ({
  ...row,
  main_category: mainCategory,
  subcategory: "",
  brand: "",
  item_id: "",
  product_name: "",
  item_code: "",
  specifications: "",
  unit: "",
  last_historical_unit_price: null,
  last_supplier_name: "",
  last_purchase_date: "",
});

export const changeSubcategory = (row, subcategory) => ({
  ...row,
  subcategory,
  brand: "",
  item_id: "",
  product_name: "",
  item_code: "",
  specifications: "",
  unit: "",
  last_historical_unit_price: null,
  last_supplier_name: "",
  last_purchase_date: "",
});

export const changeBrand = (row, brand) => ({
  ...row,
  brand,
  item_id: "",
  product_name: "",
  item_code: "",
  specifications: "",
  unit: "",
  last_historical_unit_price: null,
  last_supplier_name: "",
  last_purchase_date: "",
});

export const selectItem = (row, item) => ({
  ...row,
  main_category: selectionValue(itemMainCategory(item)),
  subcategory: selectionValue(item?.subcategory || ""),
  brand: selectionValue(item?.brand || ""),
  item_id: item?.id || "",
  product_name: itemProductName(item),
  item_code: item?.code || "",
  specifications: item?.specifications || item?.specs || "",
  unit: item?.unit || "",
  last_historical_unit_price: item?.last_price ?? null,
  last_supplier_name: item?.last_supplier || item?.preferred_supplier || "",
  last_purchase_date: item?.last_date || "",
});
