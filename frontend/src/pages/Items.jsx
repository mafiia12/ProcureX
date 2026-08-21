import CrudPage from "@/components/CrudPage";
import { fmtEGP } from "@/lib/api";
import { useNavigate } from "react-router-dom";
import { usePreferences } from "@/contexts/PreferencesContext";

export default function Items() {
  const navigate = useNavigate();
  const { tr } = usePreferences();
  return (
    <CrudPage
      title={tr("صنف", "item")}
      heading={tr("دليل الأصناف", "Items")}
      description={tr("دليل مركزي ينمو من الأصناف المعتمدة؛ الأسعار المعروضة مرجعية من السجلات الفعلية.", "A central item master built from approved items; displayed prices come from formal records.")}
      searchPlaceholder={tr("بحث بكود الصنف أو الاسم أو التصنيف...", "Search item code, name, or category...")}
      emptyTitle={tr("لا توجد أصناف حتى الآن", "No items yet")}
      emptyDescription={tr("سيتم بناء دليل الأصناف تدريجيًا من الطلبات المعتمدة، ويمكن إضافة صنف يدويًا عند الحاجة.", "The item master will grow from approved requests; you can also add an item manually.")}
      endpoint="items"
      testPrefix="items"
      primaryField="product_name"
      columns={[
        { key: "code", label: tr("كود الصنف", "Item Code") },
        { key: "product_name", label: tr("اسم المنتج", "Item Name") },
        { key: "main_category", label: tr("التصنيف", "Category") },
        { key: "subcategory", label: tr("التصنيف الفرعي", "Subcategory") },
        { key: "unit", label: tr("الوحدة", "Unit") },
        { key: "last_price", label: tr("آخر سعر عرض رسمي", "Last Formal Quoted Price"), render: (r) => (r.last_price != null ? fmtEGP(r.last_price) : "-") },
        { key: "last_supplier", label: tr("آخر / مورد مفضل", "Last / Preferred Supplier"), render: (r) => r.last_supplier || r.preferred_supplier || "-" },
        { key: "last_date", label: tr("آخر نشاط", "Last Activity") },
      ]}
      rowAction={{ label: tr("تاريخ الأسعار", "Price History"), onClick: (item) => navigate("/price-history", { state: { item: item.product_name, itemCode: item.code } }) }}
      fields={[
        { key: "product_name", label: "اسم المنتج", labelEn: "Item Name", required: true },
        { key: "brand", label: "العلامة التجارية", labelEn: "Brand" },
        { key: "main_category", label: "التصنيف الرئيسي", labelEn: "Category" },
        { key: "subcategory", label: "التصنيف الفرعي", labelEn: "Subcategory" },
        { key: "unit", label: "الوحدة", labelEn: "Unit" },
        { key: "specifications", label: "المواصفات", labelEn: "Specifications" },
        { key: "preferred_supplier", label: "المورد المفضل", labelEn: "Preferred Supplier" },
        { key: "notes", label: "ملاحظات", labelEn: "Notes", type: "textarea" },
        { key: "name", label: "اسم الصنف السابق (محفوظ للتوافق)", labelEn: "Legacy item name (compatibility)", readOnly: true },
      ]}
    />
  );
}
