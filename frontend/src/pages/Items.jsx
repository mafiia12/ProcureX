import CrudPage from "@/components/CrudPage";
import { fmtEGP } from "@/lib/api";
import { useNavigate } from "react-router-dom";

export default function Items() {
  const navigate = useNavigate();
  return (
    <CrudPage
      title="صنف"
      heading="دليل الأصناف"
      description="دليل مركزي ينمو من الأصناف المعتمدة؛ الأسعار المعروضة مرجعية من السجلات الفعلية."
      searchPlaceholder="بحث بكود الصنف أو الاسم أو التصنيف..."
      emptyTitle="لا توجد أصناف حتى الآن"
      emptyDescription="سيتم بناء دليل الأصناف تدريجيًا من الطلبات المعتمدة، ويمكن إضافة صنف يدويًا عند الحاجة."
      endpoint="items"
      testPrefix="items"
      primaryField="product_name"
      columns={[
        { key: "code", label: "كود الصنف" },
        { key: "product_name", label: "اسم المنتج" },
        { key: "main_category", label: "التصنيف" },
        { key: "subcategory", label: "التصنيف الفرعي" },
        { key: "unit", label: "الوحدة" },
        { key: "last_price", label: "آخر سعر", render: (r) => (r.last_price != null ? fmtEGP(r.last_price) : "-") },
        { key: "last_supplier", label: "آخر / مورد مفضل", render: (r) => r.last_supplier || r.preferred_supplier || "-" },
        { key: "last_date", label: "تاريخ آخر شراء" },
      ]}
      rowAction={{ label: "تاريخ الأسعار", onClick: (item) => navigate("/price-history", { state: { item: item.product_name, itemCode: item.code } }) }}
      fields={[
        { key: "product_name", label: "اسم المنتج", required: true },
        { key: "brand", label: "العلامة التجارية" },
        { key: "main_category", label: "التصنيف الرئيسي" },
        { key: "subcategory", label: "التصنيف الفرعي" },
        { key: "unit", label: "الوحدة" },
        { key: "specifications", label: "المواصفات" },
        { key: "preferred_supplier", label: "المورد المفضل" },
        { key: "notes", label: "ملاحظات", type: "textarea" },
        { key: "name", label: "اسم الصنف السابق (محفوظ للتوافق)", readOnly: true },
      ]}
    />
  );
}
