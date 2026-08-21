import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSearch, RotateCcw } from "lucide-react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";

import {
  DataTable, EmptyState, FilterBar, MoneyDisplay, PageHeader, SearchInput,
  StatusBadge,
} from "@/components/procurement-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import api, { errMsg } from "@/lib/api";
import { usePreferences } from "@/contexts/PreferencesContext";

const EMPTY_FILTERS = { item: "", supplier: "", project: "", date_from: "", date_to: "" };

export default function PriceHistory() {
  const preferences = usePreferences();
  const language = preferences.language || "ar";
  const tr = preferences.tr || ((ar, en) => (language === "en" ? en : ar));
  const location = useLocation();
  const initialFilters = {
    ...EMPTY_FILTERS,
    item: location.state?.itemCode || location.state?.item || "",
    supplier: location.state?.supplier || "",
  };
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (nextFilters) => {
    setLoading(true);
    try {
      const params = Object.fromEntries(
        Object.entries(nextFilters).filter(([, value]) => String(value || "").trim()),
      );
      const { data } = await api.get("/supplier-price-history", { params });
      setRows(data || []);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(initialFilters); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const supplierCount = useMemo(
    () => new Set(rows.map((row) => row.supplier_id || row.supplier).filter(Boolean)).size,
    [rows],
  );

  const applyFilters = () => {
    setAppliedFilters(filters);
    load(filters);
  };
  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    load(EMPTY_FILTERS);
  };

  const columns = [
    { key: "date", label: tr("التاريخ", "Date"), className: "whitespace-nowrap" },
    { key: "item", label: tr("الصنف", "Item"), className: "min-w-48", render: (row) => <div><div className="font-semibold text-foreground">{row.item_name}</div>{row.item_code && <div className="font-mono text-[11px] text-muted-foreground" dir="ltr">{row.item_code}</div>}</div> },
    { key: "supplier", label: tr("المورد", "Supplier"), className: "min-w-40" },
    { key: "project", label: tr("المشروع", "Project"), className: "min-w-40" },
    { key: "quantity", label: tr("الكمية", "Qty"), className: "text-center tabular-nums" },
    { key: "unit", label: tr("الوحدة", "Unit") },
    { key: "unit_price", label: tr("سعر الوحدة", "Unit Price"), className: "text-end", render: (row) => <MoneyDisplay value={row.unit_price} currency={row.currency === "EGP" ? tr("ج.م", "EGP") : row.currency} /> },
    { key: "adjusted_unit_price", label: tr("السعر المعدل", "Adjusted Price"), className: "text-end", render: (row) => <div><MoneyDisplay value={row.adjusted_unit_price} currency={row.currency === "EGP" ? tr("ج.م", "EGP") : row.currency} className="font-semibold" />{(Number(row.discount_pct) > 0 || Number(row.tax_pct) > 0) && <div className="mt-0.5 text-[10px] text-muted-foreground">{tr("خصم", "Discount")} {row.discount_pct || 0}% · {tr("ضريبة", "VAT")} {row.tax_pct || 0}%</div>}</div> },
    { key: "availability", label: tr("التوفر", "Availability"), render: (row) => row.availability === "available" ? <StatusBadge tone="success">{tr("متاح", "Available")}</StatusBadge> : <StatusBadge tone="danger">{tr("غير متاح", "Unavailable")}</StatusBadge> },
    { key: "rfq_number", label: "RFQ", render: (row) => <span className="font-mono text-xs" dir="ltr">{row.rfq_number || "-"}</span> },
    { key: "comparison_number", label: "CMP", render: (row) => <span className="font-mono text-xs" dir="ltr">{row.comparison_number || "-"}</span> },
  ];

  return (
    <div className="space-y-5" data-testid="price-history-page">
      <PageHeader
        title={tr("تاريخ أسعار الموردين", "Supplier Price History")}
        description={tr("أسعار فعلية من عروض الموردين المستلمة عبر RFQ والمقارنة الرسمية فقط؛ بيانات الشراء المباشر القديمة غير مختلطة بهذا السجل.", "Formal prices received through RFQs and supplier comparisons only; legacy direct purchases are excluded.")}
      />

      <FilterBar resultLabel={tr(`${rows.length} عرض سعر · ${supplierCount} مورد`, `${rows.length} quotations · ${supplierCount} suppliers`)} onClear={clearFilters}>
        <SearchInput className="w-full sm:w-64" placeholder={tr("الصنف أو كوده...", "Item or code...")} value={filters.item} onChange={(event) => setFilters((current) => ({ ...current, item: event.target.value }))} data-testid="price-history-item-filter" />
        <Input className="w-full sm:w-52" placeholder={tr("المورد...", "Supplier...")} value={filters.supplier} onChange={(event) => setFilters((current) => ({ ...current, supplier: event.target.value }))} data-testid="price-history-supplier-filter" />
        <Input className="w-full sm:w-52" placeholder={tr("المشروع...", "Project...")} value={filters.project} onChange={(event) => setFilters((current) => ({ ...current, project: event.target.value }))} data-testid="price-history-project-filter" />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">{tr("من", "From")}<Input type="date" className="w-40" value={filters.date_from} onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))} /></label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">{tr("إلى", "To")}<Input type="date" className="w-40" value={filters.date_to} onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))} /></label>
        <Button type="button" size="sm" onClick={applyFilters} disabled={loading}>{tr("تطبيق", "Apply")}</Button>
        {Object.values(appliedFilters).some(Boolean) && <Button type="button" size="sm" variant="ghost" onClick={clearFilters}><RotateCcw className="h-4 w-4" /> {tr("الكل", "Reset")}</Button>}
      </FilterBar>

      {loading ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">{tr("جارٍ تحميل تاريخ الأسعار...", "Loading price history...")}</div>
      ) : (
        <DataTable columns={columns} rows={rows} rowTestId="price-history-row" tableClassName="min-w-[1080px]" empty={<EmptyState icon={FileSearch} title={tr("لا يوجد تاريخ أسعار مطابق", "No matching price history")} description={tr("يظهر السجل بعد استلام أول عرض مورد رسمي. غيّر الفلاتر أو افتح RFQ لتسجيل عرض سعر.", "History appears after the first formal supplier quotation. Adjust the filters or open an RFQ to record one.")} />} />
      )}
    </div>
  );
}
