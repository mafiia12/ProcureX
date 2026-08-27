import CrudPage from "@/components/CrudPage";
import { Button } from "@/components/ui/button";
import { fmtEGP } from "@/lib/api";
import { useNavigate } from "react-router-dom";
import { usePreferences } from "@/contexts/PreferencesContext";
import { Pencil, History } from "lucide-react";

function DetailRow({ label, value, dir }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-foreground" dir={dir} title={typeof value === "string" ? value : undefined}>
        {value || "-"}
      </dd>
    </div>
  );
}

function ItemDrawer({ item, tr, onEdit, onViewHistory }) {
  return (
    <div className="mt-1 space-y-4">
      <div>
        <div className="text-lg font-bold text-foreground">{item.product_name}</div>
        <div className="mt-0.5 font-mono text-xs text-muted-foreground" dir="ltr">{item.code}</div>
      </div>

      <section>
        <h3 className="mb-2 text-xs font-bold text-muted-foreground">{tr("بيانات أساسية", "Primary info")}</h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          <DetailRow label={tr("التصنيف الرئيسي", "Main category")} value={item.main_category} />
          <DetailRow label={tr("التصنيف الفرعي", "Subcategory")} value={item.subcategory} />
          <DetailRow label={tr("الوحدة", "Unit")} value={item.unit} />
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold text-muted-foreground">{tr("بيانات الشراء", "Procurement info")}</h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          <DetailRow label={tr("آخر سعر عرض رسمي", "Last formal price")} value={item.last_price != null ? fmtEGP(item.last_price) : "-"} />
          <DetailRow label={tr("آخر مورد", "Last supplier")} value={item.last_supplier} />
          <DetailRow label={tr("المورد المفضل", "Preferred supplier")} value={item.preferred_supplier} />
        </dl>
      </section>

      <div className="flex flex-wrap gap-2 border-t pt-3">
        <Button size="sm" onClick={onEdit} className="gap-1.5"><Pencil className="h-3.5 w-3.5" /> {tr("تعديل", "Edit")}</Button>
        <Button size="sm" variant="outline" onClick={onViewHistory} className="gap-1.5"><History className="h-3.5 w-3.5" /> {tr("تاريخ الأسعار", "Price history")}</Button>
      </div>
    </div>
  );
}

export default function Items() {
  const navigate = useNavigate();
  const { tr } = usePreferences();
  const goToHistory = (item) => navigate("/price-history", { state: { item: item.product_name, itemCode: item.code } });

  return (
    <CrudPage
      title={tr("صنف", "item")}
      heading={tr("دليل الأصناف", "Items")}
      description={tr("دليل الأصناف مع آخر سعر ومورد معتمد.", "Item directory with the latest price and supplier.")}
      searchPlaceholder={tr("ابحث بكود الصنف أو الاسم...", "Search by item code or name...")}
      emptyTitle={tr("لا توجد أصناف", "No items")}
      emptyDescription={tr("ابدأ بإضافة أول صنف.", "Start by adding your first item.")}
      compactManagement
      endpoint="items"
      testPrefix="items"
      primaryField="product_name"
      columns={[
        { key: "code", label: tr("كود الصنف", "Item Code"), ltr: true, className: "font-mono text-xs" },
        { key: "product_name", label: tr("اسم الصنف", "Item Name"), truncate: true },
        { key: "main_category", label: tr("التصنيف الرئيسي", "Main Category"), hideOnMobile: true, truncate: true },
        { key: "unit", label: tr("الوحدة", "Unit") },
        { key: "last_price", label: tr("آخر سعر عرض رسمي", "Last Formal Quoted Price"), hideOnMobile: true, render: (r) => (r.last_price != null ? fmtEGP(r.last_price) : "-") },
        { key: "last_supplier", label: tr("آخر / مورد مفضل", "Last / Preferred Supplier"), hideOnMobile: true, truncate: true, render: (r) => r.last_supplier || r.preferred_supplier || "-" },
      ]}
      filters={[
        { key: "main_category", label: tr("التصنيف", "Category"), allLabel: tr("كل التصنيفات", "All categories") },
      ]}
      rowAction={{ label: tr("تاريخ الأسعار", "Price History"), onClick: goToHistory }}
      renderDrawer={(item, { tr: t, edit }) => (
        <ItemDrawer item={item} tr={t} onEdit={() => edit(item)} onViewHistory={() => goToHistory(item)} />
      )}
      fields={[
        { key: "product_name", label: "اسم الصنف", labelEn: "Item Name", required: true },
        { key: "main_category", label: "التصنيف الرئيسي", labelEn: "Main Category" },
        { key: "unit", label: "الوحدة", labelEn: "Unit" },
      ]}
      advancedFields={[
        { key: "subcategory", label: "التصنيف الفرعي", labelEn: "Subcategory" },
        { key: "brand", label: "العلامة التجارية", labelEn: "Brand" },
        { key: "preferred_supplier", label: "المورد المفضل", labelEn: "Preferred Supplier" },
        { key: "specifications", label: "المواصفات", labelEn: "Specifications" },
        { key: "notes", label: "ملاحظات", labelEn: "Notes", type: "textarea" },
        { key: "name", label: "اسم الصنف السابق (محفوظ للتوافق)", labelEn: "Legacy item name (compatibility)", readOnly: true },
      ]}
    />
  );
}
