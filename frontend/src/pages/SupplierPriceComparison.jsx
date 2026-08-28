import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, FilePlus2,
  FolderOpen, MoreHorizontal, PackagePlus, Pencil, Plus, Printer, Save, Trash2, UserPlus,
  Send, Paperclip, ExternalLink, SlidersHorizontal, Upload,
} from "lucide-react";
import { toast } from "sonner";

import SearchableSelect from "@/components/SearchableSelect";
import { usePreferences } from "@/contexts/PreferencesContext";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  brandOptions, changeBrand, changeMainCategory, changeSubcategory, filterItems,
  mainCategoryOptions, selectItem, subcategoryOptions,
} from "@/lib/itemSelection";
import api, { errMsg, fmt } from "@/lib/api";
import useUnsavedChanges from "@/hooks/useUnsavedChanges";
import {
  calculateComparison, calculateSupplierTotal, emptyComparisonRow, manualEntryKey,
  supplierOffersFromRows,
} from "@/lib/priceComparison";
import {
  EmptyState, StatusBadge,
} from "@/components/procurement-ui";
import { useOptionalAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";


const today = () => new Date().toISOString().slice(0, 10);
const money = (value) => `${fmt(value)} ج.م`;
const numberFields = new Set([
  "quantity", "unit_price", "delivery_days", "selected_for_purchase",
]);
const rowPayloadFields = [
  "item_id", "item_code", "product_name", "brand", "main_category",
  "subcategory", "specifications", "supplier_id", "supplier_code",
  "supplier_name", "quantity", "unit", "unit_price", "delivery_days", "payment_terms",
  "availability", "price_valid_until", "notes",
  "selected_for_purchase",
];

const rowItemKey = (row) => (
  row.source_request_item_id || row.item_id || row.item_code || row.manual_product_key
);
const rowSupplierKey = (row) => (
  row.supplier_id || row.supplier_code || row.manual_supplier_key
);
const isManualRow = (row) => !row.item_id || !row.supplier_id;

const offerPayloadFields = [
  "supplier_id", "supplier_code", "supplier_name", "discount_pct", "tax_pct",
  "shipping_cost", "other_cost",
];
const comparisonFingerprint = ({ projectName, customerName, comparisonDate, notes, rows, supplierOffers }) => JSON.stringify({
  projectName: projectName || "",
  customerName: customerName || "",
  comparisonDate: comparisonDate || "",
  notes: notes || "",
  rows: (rows || []).map((row) => Object.fromEntries(
    rowPayloadFields.map((field) => [
      field,
      numberFields.has(field) ? Number(row[field]) || 0 : row[field] || "",
    ]),
  )),
  supplierOffers: (supplierOffers || []).map((offer) => Object.fromEntries(
    offerPayloadFields.map((field) => [
      field,
      ["discount_pct", "tax_pct", "shipping_cost", "other_cost"].includes(field)
        ? Number(offer[field]) || 0 : offer[field] || "",
    ]),
  )),
});

function Metric({ label, value, accent = "text-foreground" }) {
  return (
    <div className="rounded-md border bg-card p-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`mt-1 truncate text-sm font-bold ${accent}`} title={value || undefined}>
        {value ?? "-"}
      </div>
    </div>
  );
}

function FormField({ label, children, className = "" }) {
  return <div className={className}><Label className="text-xs">{label}</Label>{children}</div>;
}

function RequestAttachmentCard({ attachment, tr }) {
  const [objectUrl, setObjectUrl] = useState("");
  useEffect(() => {
    let active = true;
    let createdUrl = "";
    api.get(attachment.view_url, { responseType: "blob" }).then(({ data }) => {
      if (!active || !(data instanceof Blob)) return;
      createdUrl = URL.createObjectURL(data);
      setObjectUrl(createdUrl);
    }).catch(() => {});
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [attachment.view_url]);
  return <article className="rounded-lg border border-blue-500/20 bg-card p-3" data-testid="request-attachment">
    {attachment.is_image && objectUrl && <img src={objectUrl} alt={attachment.original_filename} className="mb-3 max-h-64 w-full rounded-md bg-muted object-contain" />}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0"><div className="truncate text-sm font-bold">{attachment.original_filename}</div><div className="mt-1 text-xs text-muted-foreground">{attachment.item_label || tr("مرفق طلب الشراء", "Purchase request attachment")}</div></div>
      {objectUrl && <Button asChild type="button" size="sm" variant="outline"><a href={objectUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> {tr("فتح / عرض", "Open / view")}</a></Button>}
    </div>
  </article>;
}

// A true aligned matrix: item rows share ONE CSS grid with the supplier
// columns, so row heights and header/footer bands line up natively across
// every column (the previous layout gave each supplier its own independent
// card, which only *approximated* alignment via matching min-heights).
// Each supplier's header/item-cells/footer are siblings placed by explicit
// grid-column/grid-row so a single `display:contents` wrapper can still
// carry one data-testid per supplier for the whole column.
function ComparisonMatrix({
  itemOrder, visibleSupplierGroups, tr, formatMoney, onPrice, onSelectRow, onSelectSupplier,
  onEdit, onDelete, quotationForGroup, canUpload, onUpload, onViewAttachment,
  cheapestSelectableGroup, supplierOptions, onAssignSupplier,
  onAdjustment, lastSupplierPrices, onAddToCatalog,
}) {
  const colCount = Math.max(visibleSupplierGroups.length, 1);
  const footerRow = itemOrder.length + 2;
  return (
    <div className="comparison-matrix min-h-0 flex-1 overflow-auto border bg-card" data-testid="comparison-matrix" data-density="ux-2">
      <div
        className="hidden min-w-[640px] sm:grid"
        style={{ gridTemplateColumns: `minmax(210px,1.2fr) repeat(${colCount}, minmax(205px,1fr))` }}
      >
        <div className="sticky start-0 top-0 z-30 border-b border-e bg-muted px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground" style={{ gridColumn: 1, gridRow: 1 }}>
          {tr("الصنف", "Item")}
        </div>
        {itemOrder.map((item, rowIndex) => (
          <div key={item.itemKey} className={cn("sticky start-0 z-20 flex min-h-[50px] min-w-0 flex-col justify-center border-b border-e px-2 py-1", rowIndex % 2 ? "bg-muted/15" : "bg-card")} style={{ gridColumn: 1, gridRow: rowIndex + 2 }}>
            <div className="truncate text-[13px] font-bold leading-4 text-foreground" title={item.product_name}>{item.product_name}</div>
            <div className="truncate text-[11px] leading-4 text-muted-foreground">{tr("الكمية", "Qty")}: <span className="tabular-nums">{fmt(item.quantity)}</span> {item.unit}</div>
            {!item.item_id && <div className="mt-0.5 flex items-center gap-1">
              <span className="rounded-full border border-dashed px-1.5 py-0 text-[9px] font-semibold text-muted-foreground" data-testid={`manual-item-badge-${item.itemKey}`}>{tr("صنف يدوي", "Manual item")}</span>
              <button type="button" className="text-[9px] font-semibold text-primary hover:underline" data-testid={`add-to-catalog-${item.itemKey}`} onClick={() => onAddToCatalog(item)}>{tr("إضافة للدليل", "Add to catalog")}</button>
            </div>}
          </div>
        ))}
        <div className="sticky start-0 z-20 border-t-2 border-e bg-muted px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-foreground" style={{ gridColumn: 1, gridRow: footerRow }}>
          {tr("ملخص العرض", "Offer summary")}
        </div>

        {visibleSupplierGroups.map((group, colIndex) => {
          const col = colIndex + 2;
          const summary = group.summary || {};
          const selectedCount = group.rows.filter((row) => Number(row.selected_for_purchase || 0) === 1).length;
          const isCheapestComplete = group.key === cheapestSelectableGroup?.key;
          const quotation = quotationForGroup(group);
          return (
            <div key={group.key} data-testid="supplier-offer-card" style={{ display: "contents" }}>
              <div className={cn("sticky top-0 z-20 min-h-[68px] border-b border-e bg-card/95 p-1 backdrop-blur", isCheapestComplete && "bg-emerald-50/95 dark:bg-emerald-950/30")} style={{ gridColumn: col, gridRow: 1 }}>
                {!group.supplierId ? (
                  <div data-testid="supplier-column-selector">
                    <SearchableSelect
                      value=""
                      options={supplierOptions}
                      placeholder={tr("اختر المورد", "Select supplier")}
                      searchPlaceholder={tr("ابحث باسم أو كود المورد...", "Search by supplier name or code...")}
                      testId={`supplier-selector-${group.key}`}
                      onValueChange={(value) => onAssignSupplier(group, value)}
                    />
                  </div>
                ) : (
                  <div className="flex min-w-0 items-center gap-1.5">
                    <div className="min-w-0 flex-1 truncate text-xs font-bold text-foreground" title={group.supplierName}>{group.supplierName}</div>
                    <div className="max-w-20 shrink-0 truncate font-mono text-[10px] text-muted-foreground" dir="ltr" title={group.supplierCode}>{group.supplierCode}</div>
                  </div>
                )}
                <div className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden">
                  {summary.is_complete ? <span data-testid="complete-offer-badge"><StatusBadge tone="success" className="border font-bold">{tr("عرض كامل", "Complete offer")}</StatusBadge></span> : <span data-testid="incomplete-offer-badge"><StatusBadge tone="warning" className="border font-bold">{tr("عرض غير مكتمل", "Incomplete offer")}</StatusBadge></span>}
                  {isCheapestComplete && <span data-testid="lowest-offer-badge"><StatusBadge tone="success" className="border font-bold">{tr("الأرخص كاملًا", "Cheapest complete")}</StatusBadge></span>}
                  {!!selectedCount && <StatusBadge tone="primary">{tr(`${selectedCount} مختار`, `${selectedCount} selected`)}</StatusBadge>}
                </div>
                {quotation && <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                  <StatusBadge tone={quotation.status === "received" ? "success" : quotation.status === "withdrawn" ? "danger" : "neutral"}>{quotation.status === "received" ? tr("مستلم", "Received") : quotation.status === "withdrawn" ? tr("مسحوب", "Withdrawn") : tr("مسودة", "Draft")}</StatusBadge>
                  <span className="min-w-0 flex-1 truncate" dir="ltr">{quotation.quotation_date || "-"}</span>
                  {!!quotation.attachments?.length && <button type="button" className="flex max-w-24 min-w-0 items-center gap-0.5 font-semibold text-primary hover:text-primary/80" title={`${quotation.attachments[0].original_filename}${quotation.attachments.length > 1 ? ` +${quotation.attachments.length - 1}` : ""}`} aria-label={tr("فتح مرفق عرض المورد", "Open supplier quotation attachment")} onClick={() => onViewAttachment(quotation.attachments[0])}><Paperclip className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{quotation.attachments[0].original_filename}</span>{quotation.attachments.length > 1 && <span className="shrink-0 text-[8px]">+{quotation.attachments.length - 1}</span>}</button>}
                  {canUpload && <label className="shrink-0 cursor-pointer text-primary hover:text-primary/80" title={quotation.attachments?.length ? tr("استبدال المرفق", "Replace attachment") : tr("إرفاق عرض المورد", "Attach quotation")}><Upload className="h-3.5 w-3.5" /><span className="sr-only">{quotation.attachments?.length ? tr("استبدال", "Replace") : tr("إرفاق", "Attach")}</span><input type="file" className="sr-only" accept=".pdf,.xls,.xlsx,.jpg,.jpeg,.png,.webp" multiple onChange={(event) => onUpload(quotation, Array.from(event.target.files || []))} /></label>}
                </div>}
                <div className="mt-0.5 flex items-center justify-between text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                  <span>{tr("سعر الوحدة", "Unit price")}</span><span>{tr("الإجمالي", "Total")}</span>
                </div>
              </div>

              {itemOrder.map((item, rowIndex) => {
                const row = group.rowsByItem.get(item.itemKey);
                if (!row) {
                  return (
                    <div key={item.itemKey} className={cn("flex items-center justify-center border-b border-e px-2 py-1 text-center text-[10px] text-muted-foreground", rowIndex % 2 ? "bg-muted/20" : "bg-muted/10")} style={{ gridColumn: col, gridRow: rowIndex + 2 }}>
                      <span data-testid="not-offered-badge" className="inline-flex rounded-full border border-dashed bg-background px-2 py-0.5 font-semibold">{tr("غير مقدم", "Not quoted")}</span>
                    </div>
                  );
                }
                const tone = row.selected_for_purchase ? "border-s-2 border-s-primary bg-primary/5" : row.is_unavailable ? "bg-destructive/5" : row.is_incomplete ? "bg-amber-500/5" : row.is_lowest_final_total ? "bg-emerald-500/5" : rowIndex % 2 ? "bg-muted/15" : "bg-card";
                return (
                  <div key={item.itemKey} data-testid="comparison-row" className={cn("flex min-h-[50px] flex-col justify-center border-b border-e px-1.5 py-0.5 transition-colors focus-within:bg-primary/5", tone)} style={{ gridColumn: col, gridRow: rowIndex + 2 }}>
                    <div className="flex items-center gap-1.5">
                      <Input type="number" min="0" step="0.01" value={row.unit_price || ""} onChange={(event) => onPrice(row.key, event.target.value)} className="h-7 w-20 px-1 text-end font-mono text-[13px] tabular-nums" data-testid={`inline-unit-price-${row.key}`} />
                      <span className="flex-1 text-end font-mono text-[13px] font-bold tabular-nums text-foreground" dir="ltr">{formatMoney(row.final_total)}</span>
                    </div>
                    {row.item_id && row.supplier_id && (() => {
                      const lastPrice = lastSupplierPrices[`${row.item_id}|${row.supplier_id}`];
                      return (
                        <div className="truncate text-[9.5px] text-muted-foreground" data-testid={`last-supplier-price-${row.key}`}>
                          {lastPrice
                            ? tr(`آخر سعر: ${formatMoney(lastPrice.unit_price)} — ${lastPrice.date}`, `Last price: ${formatMoney(lastPrice.unit_price)} — ${lastPrice.date}`)
                            : tr("لا يوجد سعر سابق", "No previous price")}
                        </div>
                      );
                    })()}
                    <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="shrink-0">{row.availability === "available" ? tr("متاح", "Available") : tr("غير متاح", "Unavailable")} · {row.delivery_days || 0}{tr("ي", "d")}</span>
                      {(row.is_lowest_final_total || row.is_unavailable || row.is_incomplete) && <span className="flex min-w-0 items-center gap-1 overflow-hidden">
                        {row.is_lowest_final_total && <span data-testid="lowest-price-badge"><StatusBadge tone="success" className="border font-bold">{tr("أقل سعر", "Lowest")}</StatusBadge></span>}
                        {row.is_unavailable && <StatusBadge tone="danger" className="border font-bold">{tr("غير متاح", "Unavailable")}</StatusBadge>}
                        {row.is_incomplete && <StatusBadge tone="warning" className="border font-bold">{tr("ناقص", "Incomplete")}</StatusBadge>}
                      </span>}
                      <span className="ms-auto flex shrink-0 items-center gap-0.5">
                        <button type="button" title={row.selected_for_purchase ? tr("إلغاء الاختيار", "Unselect") : tr("اختيار للشراء", "Select for purchase")} aria-label={row.selected_for_purchase ? tr("إلغاء الاختيار", "Unselect") : tr("اختيار للشراء", "Select for purchase")} aria-pressed={!!row.selected_for_purchase} className={cn("flex h-5 w-5 items-center justify-center border text-primary disabled:opacity-40", row.selected_for_purchase && "bg-primary text-primary-foreground")} onClick={() => onSelectRow(row)} disabled={!row.eligible}><Check className="h-3 w-3" /></button>
                        <button type="button" aria-label={tr("تعديل", "Edit")} title={tr("تعديل", "Edit")} className="flex h-5 w-5 items-center justify-center text-muted-foreground hover:bg-muted" onClick={() => onEdit(row)}><Pencil className="h-3 w-3" /></button>
                        <button type="button" aria-label={tr("حذف", "Delete")} title={tr("حذف", "Delete")} className="flex h-5 w-5 items-center justify-center text-destructive hover:bg-destructive/10" onClick={() => onDelete(row.key)}><Trash2 className="h-3 w-3" /></button>
                      </span>
                    </div>
                  </div>
                );
              })}

              <div className="border-t-2 border-e bg-muted/20 p-1.5" style={{ gridColumn: col, gridRow: footerRow }} data-testid="supplier-offer-summary">
                <div className="mb-2 grid grid-cols-2 gap-1">
                  {[
                    ["discount_pct", tr("الخصم %", "Discount %")],
                    ["tax_pct", tr("الضريبة %", "VAT %")],
                    ["shipping_cost", tr("الشحن", "Shipping")],
                    ["other_cost", tr("تكاليف أخرى", "Other costs")],
                  ].map(([field, label]) => <label key={field} className="text-[9.5px] text-muted-foreground">
                    <span>{label}</span>
                    <Input {...numberInputProps(field)} className="mt-0.5 h-6 px-1 text-end text-[10px] tabular-nums" value={group.offer?.[field] ?? ""} onChange={(event) => onAdjustment(group, field, event.target.value)} data-testid={`supplier-adjustment-${field}-${group.key}`} />
                  </label>)}
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px] tabular-nums">
                  <span className="text-muted-foreground">{tr("الإجمالي قبل الإضافات", "Subtotal")}</span><b className="text-end">{formatMoney(summary.items_subtotal)}</b>
                  <span className="text-muted-foreground">{tr("الخصم", "Discount")}</span><b className="text-end">-{formatMoney(summary.total_discounts)}</b>
                  <span className="text-muted-foreground">{tr("الضريبة", "VAT")}</span><b className="text-end">{formatMoney(summary.total_taxes)}</b>
                  <span className="text-muted-foreground">{tr("الشحن", "Shipping")}</span><b className="text-end">{formatMoney(summary.total_shipping)}</b>
                  <span className="text-muted-foreground">{tr("تكاليف أخرى", "Other costs")}</span><b className="text-end">{formatMoney(summary.total_other_costs)}</b>
                  <span className="border-y bg-primary/5 px-1 py-1.5 font-bold text-foreground">{tr("الإجمالي النهائي", "Final total")}</span><b className="border-y bg-primary/5 px-1 py-1.5 text-end font-mono text-primary" dir="ltr">{formatMoney(summary.final_offer_total)}</b>
                  <span className="text-muted-foreground">{tr("مدة التوريد", "Lead time")}</span><b className="text-end">{summary.maximum_delivery_days ?? "-"} {tr("يوم", "days")}</b>
                  <span className="text-muted-foreground">{tr("شروط الدفع", "Payment terms")}</span><b className="truncate text-end" title={group.rows[0]?.payment_terms}>{group.rows[0]?.payment_terms || "-"}</b>
                  <span className="text-muted-foreground">{tr("صلاحية العرض", "Offer validity")}</span><b className="text-end">{group.rows[0]?.price_valid_until || "-"}</b>
                </div>
                <div className="mt-2.5">
                  <Button type="button" size="sm" className="w-full" variant={selectedCount ? "default" : "outline"} disabled={!summary.is_complete} onClick={() => onSelectSupplier(group)} data-testid={`select-supplier-offer-${group.key}`}>
                    {selectedCount ? tr("العرض محدد للشراء", "Offer selected") : tr("اختيار عرض المورد", "Select supplier offer")}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="space-y-1.5 p-1 sm:hidden" data-testid="mobile-comparison-list">
        {itemOrder.map((item) => (
          <section key={item.itemKey} className="border bg-card">
            <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-muted px-2 py-1">
              <div className="min-w-0 truncate text-[13px] font-bold" title={item.product_name}>{item.product_name}</div>
              <div className="shrink-0 text-[11px] text-muted-foreground">{fmt(item.quantity)} {item.unit}</div>
            </header>
            {visibleSupplierGroups.map((group) => {
              const row = group.rowsByItem.get(item.itemKey);
              if (!row) return <div key={group.key} className="flex items-center justify-between border-b px-2 py-2 text-[11px]"><span className="font-semibold">{group.supplierName || tr("مورد غير محدد", "Unassigned supplier")}</span><span className="text-muted-foreground">{tr("غير مقدم", "Not quoted")}</span></div>;
              return <div key={group.key} className={cn("border-b px-2 py-1", row.selected_for_purchase && "border-s-2 border-s-primary bg-primary/5")} data-testid="mobile-comparison-row">
                <div className="flex min-w-0 items-center gap-1.5 text-[11px]"><span className="min-w-0 flex-1 truncate font-semibold">{group.supplierName || tr("مورد غير محدد", "Unassigned supplier")}</span><span className="shrink-0 font-mono text-[10px] text-muted-foreground" dir="ltr">{group.supplierCode}</span>{row.is_lowest_final_total && <StatusBadge tone="success">{tr("أقل سعر", "Lowest")}</StatusBadge>}</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <Input type="number" min="0" step="0.01" value={row.unit_price || ""} onChange={(event) => onPrice(row.key, event.target.value)} className="h-8 w-24 px-1 text-end font-mono text-[13px] tabular-nums" data-testid={`mobile-inline-unit-price-${row.key}`} />
                  <span className="min-w-0 flex-1 text-end font-mono text-[13px] font-bold" dir="ltr">{formatMoney(row.final_total)}</span>
                  <span className="text-[10px] text-muted-foreground">{row.availability === "available" ? tr("متاح", "Available") : tr("غير متاح", "Unavailable")} · {row.delivery_days || 0}{tr("ي", "d")}</span>
                  <button type="button" title={row.selected_for_purchase ? tr("إلغاء الاختيار", "Unselect") : tr("اختيار للشراء", "Select for purchase")} aria-label={row.selected_for_purchase ? tr("إلغاء الاختيار", "Unselect") : tr("اختيار للشراء", "Select for purchase")} aria-pressed={!!row.selected_for_purchase} className={cn("flex h-7 w-7 shrink-0 items-center justify-center border text-primary disabled:opacity-40", row.selected_for_purchase && "bg-primary text-primary-foreground")} onClick={() => onSelectRow(row)} disabled={!row.eligible}><Check className="h-3.5 w-3.5" /></button>
                  <button type="button" title={tr("تعديل", "Edit")} aria-label={tr("تعديل", "Edit")} className="flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground" onClick={() => onEdit(row)}><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" title={tr("حذف", "Delete")} aria-label={tr("حذف", "Delete")} className="flex h-7 w-7 shrink-0 items-center justify-center text-destructive" onClick={() => onDelete(row.key)}><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>;
            })}
          </section>
        ))}
        <details className="border bg-card">
          <summary className="cursor-pointer px-2 py-1.5 text-xs font-bold">{tr("تعديلات وملخصات الموردين", "Supplier adjustments and totals")}</summary>
          <div className="space-y-1.5 border-t p-1.5">
            {visibleSupplierGroups.map((group) => {
              const summary = group.summary || {};
              const quotation = quotationForGroup(group);
              const selectedCount = group.rows.filter((row) => Number(row.selected_for_purchase || 0) === 1).length;
              return <section key={group.key} className="border p-1.5">
                <div className="flex min-w-0 items-center gap-1.5 text-xs font-bold"><span className="min-w-0 flex-1 truncate">{group.supplierName || tr("مورد غير محدد", "Unassigned supplier")}</span>{quotation?.attachments?.[0] && <button type="button" className="flex max-w-28 min-w-0 items-center gap-0.5 text-primary" title={quotation.attachments[0].original_filename} onClick={() => onViewAttachment(quotation.attachments[0])}><Paperclip className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{quotation.attachments[0].original_filename}</span></button>}{quotation && canUpload && <label className="cursor-pointer text-primary" title={tr("إرفاق عرض المورد", "Attach quotation")}><Upload className="h-3.5 w-3.5" /><input type="file" className="sr-only" accept=".pdf,.xls,.xlsx,.jpg,.jpeg,.png,.webp" multiple onChange={(event) => onUpload(quotation, Array.from(event.target.files || []))} /></label>}</div>
                <div className="mt-1 grid grid-cols-4 gap-1">
                  {[["discount_pct", tr("الخصم %", "Discount %")], ["tax_pct", tr("الضريبة %", "VAT %")], ["shipping_cost", tr("الشحن", "Shipping")], ["other_cost", tr("أخرى", "Other")]].map(([field, label]) => <label key={field} className="text-[9.5px] text-muted-foreground"><span>{label}</span><Input {...numberInputProps(field)} className="mt-0.5 h-7 px-1 text-end text-[10px]" value={group.offer?.[field] ?? ""} onChange={(event) => onAdjustment(group, field, event.target.value)} /></label>)}
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px]"><span>{tr("الإجمالي النهائي", "Final total")}: <b className="font-mono text-primary" dir="ltr">{formatMoney(summary.final_offer_total)}</b></span><Button type="button" size="sm" className="h-7" variant={selectedCount ? "default" : "outline"} disabled={!summary.is_complete} onClick={() => onSelectSupplier(group)}>{selectedCount ? tr("العرض مختار", "Offer selected") : tr("اختيار العرض", "Select offer")}</Button></div>
              </section>;
            })}
          </div>
        </details>
      </div>
    </div>
  );
}

function numberInputProps(field) {
  return {
    type: "number",
    min: 0,
    max: field === "discount_pct" || field === "tax_pct" ? 100 : undefined,
    step: "any",
  };
}

export default function SupplierPriceComparison({ initialComparison = null }) {
  const { language, direction } = usePreferences();
  const { user } = useOptionalAuth() || {};
  const location = useLocation();
  const navigate = useNavigate();
  const sourceRequest = location.state?.sourceRequest || null;
  const tr = (arabic, english) => language === "en" ? english : arabic;
  const formatMoney = (value) => language === "en"
    ? `${fmt(value)} EGP`
    : money(value);
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [comparisonId, setComparisonId] = useState(initialComparison?.id || "");
  const [comparisonNumber, setComparisonNumber] = useState(
    initialComparison?.comparison_number || "",
  );
  const [projectName, setProjectName] = useState(initialComparison?.project_name || "");
  const [customerName, setCustomerName] = useState(initialComparison?.customer_name || "");
  const [sourceRequestId, setSourceRequestId] = useState(
    initialComparison?.source_request_id || "",
  );
  const [sourceRequestNumber, setSourceRequestNumber] = useState(
    initialComparison?.source_request_number || "",
  );
  const [sourceAttachments, setSourceAttachments] = useState(
    initialComparison?.source_attachments || [],
  );
  const [sourceRfqId, setSourceRfqId] = useState(
    initialComparison?.source_rfq_id || location.state?.rfqId || "",
  );
  const [sourceRfqNumber, setSourceRfqNumber] = useState(
    initialComparison?.source_rfq_number || location.state?.rfqNumber || "",
  );
  const [supplierQuotations, setSupplierQuotations] = useState(
    initialComparison?.supplier_quotations || location.state?.supplierQuotations || [],
  );
  const [sourceRfqItems, setSourceRfqItems] = useState([]);
  const [supplierPage, setSupplierPage] = useState(0);
  const canUploadQuotation = ["admin", "procurement_responsible"].includes(user?.role);
  useEffect(() => {
  if (!sourceRequest) return;

  setProjectName(sourceRequest.project_name || "");
  setCustomerName(
    sourceRequest.company_name ||
    sourceRequest.requester_name ||
    ""
  );
  setSourceRequestId(sourceRequest.request_id || "");
  setSourceRequestNumber(sourceRequest.request_number || "");
  setSourceAttachments((sourceRequest.items || []).filter((item) => item.attachment).map((item) => ({
    ...item.attachment,
    request_item_id: item.id,
    item_label: item.product_name,
    is_image: String(item.attachment.media_type || "").startsWith("image/"),
    view_url: `/internal/incoming-purchase-requests/${sourceRequest.request_id}/attachments/${item.attachment.id}`,
  })));
}, [sourceRequest]);
  useEffect(() => {
    const rfqRows = location.state?.rfqRows;
    if (!rfqRows || !rfqRows.length) return;
    setRows((current) => [
      ...current,
      ...rfqRows.map((row) => ({
        ...emptyComparisonRow(),
        ...row,
        key: globalThis.crypto?.randomUUID?.() || `rfq-row-${Date.now()}-${Math.random()}`,
        entry_mode: row.item_id ? "system" : "manual",
        manual_product_key: row.item_id ? "" : manualEntryKey(
          "item", row.product_name, row.brand, row.main_category, row.subcategory, row.specifications,
        ),
      })),
    ]);
    setSourceRfqId(location.state?.rfqId || "");
    setSupplierQuotations(location.state?.supplierQuotations || []);
    setSupplierOffers(supplierOffersFromRows(rfqRows, comparisonDate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state?.rfqRows]);
  const [comparisonDate, setComparisonDate] = useState(
    initialComparison?.comparison_date || today(),
  );
  const [notes, setNotes] = useState(initialComparison?.notes || "");
  const [rows, setRows] = useState(() => initialComparison?.rows?.map((row) => ({
    ...row,
    key: row.id || globalThis.crypto?.randomUUID?.(),
    entry_mode: isManualRow(row) ? "manual" : "system",
  })) || []);
  const [supplierOffers, setSupplierOffers] = useState(() => (
    initialComparison?.supplier_offers
    || supplierOffersFromRows(
      initialComparison?.rows || [], initialComparison?.comparison_date || today(),
    )
  ));
  const [search, setSearch] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [subcategoryFilter, setSubcategoryFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState("");
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [showDetailedTable, setShowDetailedTable] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [saved, setSaved] = useState([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [editingKey, setEditingKey] = useState("");
  const [draft, setDraft] = useState(() => ({ ...emptyComparisonRow(), entry_mode: "system" }));
  const [confirmation, setConfirmation] = useState("");
  const [savingMaster, setSavingMaster] = useState(false);
  const [lastSupplierPrices, setLastSupplierPrices] = useState({});
  const [catalogTarget, setCatalogTarget] = useState(null);
  const [catalogForm, setCatalogForm] = useState({ name: "", unit: "", main_category: "", subcategory: "" });
  const [savingCatalog, setSavingCatalog] = useState(false);
  const savedFingerprintRef = useRef(comparisonFingerprint({
    projectName: initialComparison?.project_name,
    customerName: initialComparison?.customer_name,
    comparisonDate: initialComparison?.comparison_date || today(),
    notes: initialComparison?.notes,
    rows: initialComparison?.rows || [],
    supplierOffers: initialComparison?.supplier_offers || supplierOffersFromRows(
      initialComparison?.rows || [], initialComparison?.comparison_date || today(),
    ),
  }));

  useEffect(() => {
    Promise.all([
      api.get("/items"), api.get("/suppliers"), api.get("/projects"),
      api.get("/customers"),
    ]).then(([itemResult, supplierResult, projectResult, customerResult]) => {
      setItems(itemResult.data);
      setSuppliers(supplierResult.data);
      setProjects(projectResult.data);
      setCustomers(customerResult.data);
    }).catch((error) => toast.error(errMsg(error)));
  }, []);

  const supplierOptions = useMemo(() => suppliers.map((supplier) => ({
    value: supplier.id,
    label: `${supplier.code} — ${supplier.name}`,
    searchText: `${supplier.specialty || ""} ${supplier.phone || ""} ${supplier.email || ""}`,
  })), [suppliers]);
  const categoryChoices = useMemo(() => mainCategoryOptions(items), [items]);
  const subcategoryChoices = useMemo(
    () => subcategoryOptions(items, draft.main_category),
    [items, draft.main_category],
  );
  const brandChoices = useMemo(
    () => brandOptions(items, draft.main_category, draft.subcategory),
    [items, draft.main_category, draft.subcategory],
  );
  const matchingItems = useMemo(
    () => filterItems(items, draft.main_category, draft.subcategory, draft.brand),
    [items, draft.main_category, draft.subcategory, draft.brand],
  );
  const productOptions = useMemo(() => matchingItems.map((item) => ({
    value: item.id,
    label: `${item.code} — ${item.product_name || item.name}`,
    searchText: `${item.brand || ""} ${item.main_category || item.category || ""} ${item.subcategory || ""} ${item.specifications || item.specs || ""} ${item.unit || ""}`,
  })), [matchingItems]);

  const calculations = useMemo(
    () => calculateComparison(rows, items, suppliers, comparisonDate, supplierOffers),
    [rows, items, suppliers, comparisonDate, supplierOffers],
  );

  const lastSupplierPricePairsKey = useMemo(() => {
    const pairs = new Set();
    calculations.rows.forEach((row) => {
      if (row.item_id && row.supplier_id) pairs.add(`${row.item_id}:${row.supplier_id}`);
    });
    return [...pairs].sort().join(",");
  }, [calculations.rows]);

  useEffect(() => {
    if (!lastSupplierPricePairsKey) { setLastSupplierPrices({}); return; }
    let cancelled = false;
    api.get("/price-comparisons/last-formal-prices", { params: { pairs: lastSupplierPricePairsKey } }).then(({ data }) => {
      if (!cancelled) setLastSupplierPrices(data.prices || {});
    }).catch(() => { if (!cancelled) setLastSupplierPrices({}); });
    return () => { cancelled = true; };
  }, [lastSupplierPricePairsKey]);
  const productFilterOptions = useMemo(() => {
    const unique = new Map();
    calculations.rows.forEach((row) => unique.set(rowItemKey(row), row.product_name));
    return [...unique.entries()];
  }, [calculations.rows]);
  const supplierFilterOptions = useMemo(() => {
    const unique = new Map();
    calculations.rows.forEach((row) => unique.set(rowSupplierKey(row), row.supplier_name));
    return [...unique.entries()];
  }, [calculations.rows]);
  const offerClassificationOptions = useMemo(() => {
    const categoryRows = categoryFilter
      ? calculations.rows.filter((row) => row.main_category === categoryFilter)
      : calculations.rows;
    const subcategoryRows = subcategoryFilter
      ? categoryRows.filter((row) => row.subcategory === subcategoryFilter)
      : categoryRows;
    return {
      categories: [...new Set(calculations.rows.map((row) => row.main_category).filter(Boolean))].sort(),
      subcategories: [...new Set(categoryRows.map((row) => row.subcategory).filter(Boolean))].sort(),
      brands: [...new Set(subcategoryRows.map((row) => row.brand).filter(Boolean))].sort(),
    };
  }, [calculations.rows, categoryFilter, subcategoryFilter]);
  const filteredRows = useMemo(() => calculations.rows.filter((row) => {
    const query = search.trim().toLocaleLowerCase("ar");
    if (query && !`${row.product_name} ${row.supplier_name}`.toLocaleLowerCase("ar").includes(query)) {
      return false;
    }
    if (productFilter && rowItemKey(row) !== productFilter) return false;
    if (supplierFilter && rowSupplierKey(row) !== supplierFilter) return false;
    if (categoryFilter && row.main_category !== categoryFilter) return false;
    if (subcategoryFilter && row.subcategory !== subcategoryFilter) return false;
    if (brandFilter && row.brand !== brandFilter) return false;
    return !availabilityFilter || row.availability === availabilityFilter;
  }), [
    calculations.rows, search, productFilter, supplierFilter, categoryFilter,
    subcategoryFilter, brandFilter, availabilityFilter,
  ]);
  const itemOrder = useMemo(() => {
    const unique = new Map();
    calculations.rows.forEach((row) => {
      const key = rowItemKey(row);
      if (key && !unique.has(key)) unique.set(key, { ...row, itemKey: key });
    });
    return [...unique.values()];
  }, [calculations.rows]);
  const supplierOfferGroups = useMemo(() => {
    const summaries = new Map(calculations.supplier_summaries.map((summary) => [
      summary.supplier_id || summary.supplier_code || summary.supplier_name,
      summary,
    ]));
    const groups = new Map();
    calculations.rows.forEach((row) => {
      const key = rowSupplierKey(row) || row.supplier_slot || `unassigned-${row.key}`;
      if (!groups.has(key)) groups.set(key, {
        key,
        supplierId: row.supplier_id || "",
        supplierName: row.supplier_name,
        supplierCode: row.supplier_code,
        rows: [],
        rowsByItem: new Map(),
        summary: summaries.get(key),
        offer: supplierOffers.find((offer) => rowSupplierKey(offer) === key),
      });
      groups.get(key).rows.push(row);
      groups.get(key).rowsByItem.set(rowItemKey(row), row);
    });
    return [...groups.values()];
  }, [calculations.rows, calculations.supplier_summaries, supplierOffers]);
  useEffect(() => {
    if (!sourceRfqId) { setSourceRfqItems([]); setSourceRfqNumber(""); return; }
    api.get(`/workflow/rfqs/${sourceRfqId}`).then(({ data }) => {
      setSourceRfqItems(data.items || []);
      setSourceRfqNumber(data.rfq_number || sourceRfqId);
      if (data.quotations) setSupplierQuotations(data.quotations);
    }).catch(() => setSourceRfqItems([]));
  }, [sourceRfqId]);
  const filteredItemOrder = useMemo(() => {
    const unique = new Map();
    filteredRows.forEach((row) => {
      const key = rowItemKey(row);
      if (key && !unique.has(key)) unique.set(key, { ...row, itemKey: key });
    });
    return [...unique.values()];
  }, [filteredRows]);
  const filteredSupplierGroups = useMemo(() => supplierOfferGroups
    .filter((group) => !supplierFilter || group.key === supplierFilter)
    .map((group) => {
      const groupRows = filteredRows.filter((row) => (
        rowSupplierKey(row) || row.supplier_slot || `unassigned-${row.key}`
      ) === group.key);
      return { ...group, rowsByItem: new Map(groupRows.map((row) => [rowItemKey(row), row])) };
    }), [supplierOfferGroups, supplierFilter, filteredRows]);
  const supplierPageCount = Math.max(1, Math.ceil(filteredSupplierGroups.length / 3));
  const visibleSupplierGroups = filteredSupplierGroups.slice(supplierPage * 3, supplierPage * 3 + 3);
  useEffect(() => {
    if (supplierPage >= supplierPageCount) setSupplierPage(supplierPageCount - 1);
  }, [supplierPage, supplierPageCount]);

  const currentFingerprint = useMemo(() => comparisonFingerprint({
    projectName, customerName, comparisonDate, notes, rows, supplierOffers,
  }), [projectName, customerName, comparisonDate, notes, rows, supplierOffers]);
  const hasUnsavedChanges = savedFingerprintRef.current !== currentFingerprint;
  useUnsavedChanges(
    hasUnsavedChanges && !saving,
    tr(
      "لديك تغييرات غير محفوظة في المقارنة. هل تريد مغادرة الصفحة؟",
      "You have unsaved comparison changes. Do you want to leave this page?",
    ),
  );

  const reset = () => {
    if (hasUnsavedChanges && !window.confirm(tr(
      "سيتم فقد التغييرات غير المحفوظة. هل تريد المتابعة؟",
      "Unsaved changes will be lost. Do you want to continue?",
    ))) return;
    savedFingerprintRef.current = comparisonFingerprint({
      projectName: "", customerName: "", comparisonDate: today(), notes: "", rows: [], supplierOffers: [],
    });
    setComparisonId("");
    setComparisonNumber("");
    setProjectName("");
    setCustomerName("");
    setSourceRequestId("");
    setSourceRequestNumber("");
    setSourceAttachments([]);
    setSourceRfqId("");
    setSourceRfqNumber("");
    setSupplierQuotations([]);
    setSupplierPage(0);
    setComparisonDate(today());
    setNotes("");
    setRows([]);
    setSupplierOffers([]);
    setSearch("");
    setProductFilter("");
    setSupplierFilter("");
    setCategoryFilter("");
    setSubcategoryFilter("");
    setBrandFilter("");
    setAvailabilityFilter("");
  };
  const sourceRequestItemToRow = (requestItem, supplier = {}, supplierSlot = "") => {
    const linkedItemId = requestItem.master_item_id || requestItem.item_id || "";
    const systemItem = items.find((entry) => entry.id === linkedItemId);

  let row = {
    ...emptyComparisonRow(),
    key:
      globalThis.crypto?.randomUUID?.() ||
      `request-row-${Date.now()}-${Math.random()}`,
    quantity: Number(requestItem.quantity || 1),
    unit: requestItem.unit || "",
    unit_price: 0,
    supplier_id: "",
    supplier_code: "",
    supplier_name: "",
    selected_for_purchase: 0,
    source_request_item_id: requestItem.id || requestItem.source_request_item_id || "",
    supplier_slot: supplierSlot,
  };

  // لو الصنف مربوط بصنف موجود بالفعل في Master Items
  if (systemItem) {
    row = {
      ...selectItem(row, systemItem),
      key: row.key,
      quantity: Number(requestItem.quantity || 1),
      unit: requestItem.unit || systemItem.unit || "",
      item_code: requestItem.item_code || systemItem.code || "",
      product_name: requestItem.product_name
        || systemItem.product_name || systemItem.name || "",
      specifications: requestItem.specifications
        || systemItem.specifications || systemItem.specs || "",
      brand: requestItem.preferred_brand || requestItem.brand
        || systemItem.brand || "",
      main_category: requestItem.main_category
        || systemItem.main_category || systemItem.category || "",
      subcategory: requestItem.subcategory || systemItem.subcategory || "",
      supplier_id: supplier.id || "",
      supplier_code: supplier.code || "",
      supplier_name: supplier.name || "",
      selected_for_purchase: 0,
      entry_mode: "system",
    };

    return row;
  }

  // لو الصنف جاي يدوي من طلب الشراء
  const productName = requestItem.product_name || "";

  row = {
    ...row,
    item_id: "",
    item_code: requestItem.item_code || "",
    product_name: productName,
    brand: requestItem.preferred_brand || requestItem.brand || "",
    main_category: requestItem.main_category || "",
    subcategory: requestItem.subcategory || "",
    specifications: requestItem.specifications || "",
    entry_mode: "manual",

    manual_product_key: manualEntryKey(
      "item",
      productName,
      requestItem.preferred_brand || requestItem.brand || "",
      requestItem.main_category || "",
      requestItem.subcategory || "",
      requestItem.specifications || "",
    ),

    manual_supplier_key: "",
    supplier_id: supplier.id || "",
    supplier_code: supplier.code || "",
    supplier_name: supplier.name || "",
  };

  return row;
  };


  const addSourceRequestItem = (requestItem) => {
    if (requestItem.review_status !== "approved") {
      toast.error(tr("هذا الصنف غير مؤهل للمقارنة", "This item is not eligible for comparison"));
      return;
    }
    const groups = supplierOfferGroups.length ? supplierOfferGroups : [{
      key: `slot-${globalThis.crypto?.randomUUID?.() || Date.now()}`,
      rows: [], rowsByItem: new Map(),
    }];
    const additions = groups.flatMap((group) => {
      const first = group.rows?.[0] || {};
      const supplier = suppliers.find((entry) => entry.id === first.supplier_id) || {};
      const candidate = sourceRequestItemToRow(
        requestItem, supplier, first.supplier_slot || group.key,
      );
      return group.rowsByItem?.has(rowItemKey(candidate)) ? [] : [candidate];
    });
    const hadSupplierGroups = supplierOfferGroups.length > 0;
    setRows((current) => {
      if (!hadSupplierGroups && current.some(
        (row) => row.source_request_item_id === requestItem.id,
      )) return current;
      const uniqueAdditions = additions.filter((candidate) => !current.some((row) => (
        row.source_request_item_id === candidate.source_request_item_id
        && (rowSupplierKey(row) || row.supplier_slot)
          === (rowSupplierKey(candidate) || candidate.supplier_slot)
      )));
      return [...current, ...uniqueAdditions];
    });

  toast.success(
    tr(
      `تمت إضافة ${requestItem.product_name || "الصنف"} للمقارنة`,
      "Item added to comparison"
    )
  );
  };


  const addAllSourceRequestItems = () => {
    const requestItems = (sourceRequest?.items || []).filter(
      (item) => item.review_status === "approved",
    );

  if (!requestItems.length) {
    toast.error(
      tr(
        "لا توجد أصناف معتمدة مؤهلة في طلب الشراء",
        "There are no approved eligible items in the purchase request"
      )
    );
    return;
  }

  const groups = supplierOfferGroups.length ? supplierOfferGroups : [{
    key: `slot-${globalThis.crypto?.randomUUID?.() || Date.now()}`,
    rows: [], rowsByItem: new Map(),
  }];
  const additions = [];
  groups.forEach((group) => {
    const first = group.rows?.[0] || {};
    const supplier = suppliers.find((entry) => entry.id === first.supplier_id) || {};
    requestItems.forEach((requestItem) => {
      const candidate = sourceRequestItemToRow(
        requestItem, supplier, first.supplier_slot || group.key,
      );
      if (!group.rowsByItem?.has(rowItemKey(candidate))) additions.push(candidate);
    });
  });
  setRows((current) => [...current, ...additions]);

  toast.success(
    tr(
      `تمت إضافة ${additions.length} صف مؤهل إلى شبكة المقارنة`,
      `${additions.length} eligible rows added to the comparison grid`
    )
  );
  };
  const addSupplierColumn = () => {
    if (!itemOrder.length) {
      toast.error(tr("أضف الأصناف المؤهلة أولًا", "Add eligible items first"));
      return;
    }
    if (supplierOfferGroups.some((group) => !group.supplierId)) {
      toast.error(tr("اختر مورد العمود الحالي أولًا", "Select the supplier for the current column first"));
      return;
    }
    const slot = `slot-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
    setRows((current) => [...current, ...itemOrder.map((item) => ({
      ...emptyComparisonRow(), ...item,
      id: undefined,
      key: globalThis.crypto?.randomUUID?.() || `supplier-row-${Date.now()}-${Math.random()}`,
      supplier_id: "", supplier_code: "", supplier_name: "",
      supplier_slot: slot, selected_for_purchase: 0, unit_price: 0,
      entry_mode: item.item_id ? "system" : "manual",
    }))]);
  };

  const ensureSupplierQuotation = async (supplierId) => {
    let rfqId = sourceRfqId;
    if (!rfqId && sourceRequestId) {
      const { data } = await api.post("/workflow/rfqs", { source_request_id: sourceRequestId });
      rfqId = data.rfq.id;
      setSourceRfqId(rfqId);
      setSourceRfqItems(data.rfq.items || []);
    }
    if (!rfqId) return null;
    await api.post(`/workflow/rfqs/${rfqId}/suppliers`, { supplier_id: supplierId });
    const { data } = await api.post(`/workflow/rfqs/${rfqId}/quotations`, { supplier_id: supplierId });
    setSupplierQuotations((current) => [
      ...current.filter((item) => item.id !== data.quotation.id), data.quotation,
    ]);
    return data.quotation;
  };

  const assignSupplierToGroup = async (group, supplierId) => {
    if (supplierOfferGroups.some((entry) => entry.key !== group.key && entry.supplierId === supplierId)) {
      toast.error(tr("هذا المورد مستخدم بالفعل في المقارنة", "This supplier is already used in the comparison"));
      return;
    }
    const supplier = suppliers.find((entry) => entry.id === supplierId);
    if (!supplier) return;
    try {
      await ensureSupplierQuotation(supplierId);
      setRows((current) => current.map((row) => {
        const currentKey = rowSupplierKey(row) || row.supplier_slot || `unassigned-${row.key}`;
        return currentKey === group.key ? {
          ...row, supplier_id: supplier.id, supplier_code: supplier.code,
          supplier_name: supplier.name, supplier_slot: "", manual_supplier_key: "",
          selected_for_purchase: 0,
        } : row;
      }));
      setSupplierOffers((current) => [
        ...current.filter((offer) => rowSupplierKey(offer) !== group.key),
        {
          supplier_id: supplier.id, supplier_code: supplier.code,
          supplier_name: supplier.name, discount_pct: 0, tax_pct: 0,
          shipping_cost: 0, other_cost: 0,
        },
      ]);
      toast.success(tr(`تم اختيار المورد ${supplier.name}`, `Supplier ${supplier.name} selected`));
    } catch (error) {
      toast.error(errMsg(error));
    }
  };
  const openNewOffer = (mode = "system") => {
    setEditingKey("");
    setDraft({ ...emptyComparisonRow(), entry_mode: mode });
    setOfferOpen(true);
  };
  const editRow = (row) => {
    const item = items.find((entry) => entry.id === row.item_id);
    setEditingKey(row.key);
    setDraft({
      ...(item ? selectItem(row, item) : row),
      entry_mode: isManualRow(row) ? "manual" : "system",
    });
    setOfferOpen(true);
  };
  const switchEntryMode = (mode) => {
    setDraft((current) => ({
      ...emptyComparisonRow(),
      quantity: current.quantity,
      unit_price: current.unit_price,
      delivery_days: current.delivery_days,
      availability: current.availability,
      entry_mode: mode,
    }));
  };
  const updateDraft = (field, value) => setDraft((current) => {
    const next = { ...current, [field]: value };
    if (current.entry_mode === "manual" && [
      "product_name", "brand", "main_category", "subcategory", "specifications",
    ].includes(field)) {
      next.item_code = "";
      next.manual_product_key = "";
    }
    if (current.entry_mode === "manual" && field === "supplier_name") {
      next.supplier_code = "";
      next.manual_supplier_key = "";
    }
    return next;
  });
  const clearItemFilters = () => setDraft((current) => changeMainCategory(current, ""));

  const chooseSupplier = (supplierId) => {
    const supplier = suppliers.find((entry) => entry.id === supplierId);
    setDraft((current) => ({
      ...current,
      supplier_id: supplierId,
      supplier_code: supplier?.code || "",
      supplier_name: supplier?.name || "",
    }));
  };
  const chooseItem = (itemId) => {
    const item = items.find((entry) => entry.id === itemId);
    if (item) setDraft((current) => selectItem(current, item));
  };

  const validateDraft = () => {
    if (draft.entry_mode === "system" && !draft.supplier_id) return tr("اختر المورد", "Select a supplier");
    if (draft.entry_mode === "system" && !draft.item_id) return tr("اختر المنتج", "Select a product");
    if (draft.entry_mode === "manual" && !draft.supplier_name.trim()) return tr("اسم المورد اليدوي مطلوب", "Manual supplier name is required");
    if (draft.entry_mode === "manual" && !draft.product_name.trim()) return tr("اسم المنتج اليدوي مطلوب", "Manual product name is required");
    if (!(Number(draft.quantity) > 0)) return tr("الكمية يجب أن تكون أكبر من صفر", "Quantity must be greater than zero");
    return null;
  };

  const commitDraft = () => {
    const error = validateDraft();
    if (error) { toast.error(error); return; }
    const prepared = {
      ...draft,
      key: editingKey || draft.key || globalThis.crypto?.randomUUID?.(),
      manual_product_key: draft.item_id ? "" : manualEntryKey(
        "item", draft.product_name, draft.brand, draft.main_category,
        draft.subcategory, draft.specifications,
      ),
      manual_supplier_key: draft.supplier_id ? "" : manualEntryKey(
        "supplier", draft.supplier_name,
      ),
    };
    const productIdentity = rowItemKey(prepared);
    const supplierIdentity = rowSupplierKey(prepared);
    const duplicate = rows.some((row) => (
      row.key !== editingKey
      && rowItemKey(row) === productIdentity
      && rowSupplierKey(row) === supplierIdentity
    ));
    if (duplicate) {
      toast.error(tr("هذا المنتج والمورد مضافان بالفعل داخل المقارنة", "This product and supplier are already in the comparison"));
      return;
    }
    setRows((current) => editingKey
      ? current.map((row) => (row.key === editingKey ? prepared : row))
      : [...current, prepared]);
    setSupplierOffers((current) => current.some(
      (offer) => rowSupplierKey(offer) === supplierIdentity,
    ) ? current : [...current, {
      supplier_id: prepared.supplier_id || "",
      supplier_code: prepared.supplier_code || supplierIdentity,
      supplier_name: prepared.supplier_name || "",
      discount_pct: 0, tax_pct: 0, shipping_cost: 0, other_cost: 0,
    }]);
    setOfferOpen(false);
    toast.success(editingKey ? tr("تم تحديث العرض", "Offer updated") : tr("تمت إضافة العرض", "Offer added"));
  };
  const updateRowField = (rowKey, field, value) => {
    setRows((current) => current.map((row) => {
      if (row.key !== rowKey) return row;
      const updated = { ...row, [field]: value };
      if (["quantity", "unit_price", "availability", "price_valid_until"].includes(field)) {
        updated.selected_for_purchase = 0;
      }
      return updated;
    }));
  };

  const updateSupplierAdjustment = (group, field, value) => {
    setSupplierOffers((current) => {
      const existing = current.find((offer) => rowSupplierKey(offer) === group.key);
      const next = existing || {
        supplier_id: group.supplierId || "",
        supplier_code: group.supplierCode || group.key,
        supplier_name: group.supplierName || "",
        discount_pct: 0, tax_pct: 0, shipping_cost: 0, other_cost: 0,
      };
      return [
        ...current.filter((offer) => rowSupplierKey(offer) !== group.key),
        { ...next, [field]: value },
      ];
    });
    setRows((current) => current.map((row) => (
      rowSupplierKey(row) === group.key ? { ...row, selected_for_purchase: 0 } : row
    )));
  };

  const updateRowSupplier = (rowKey, supplierId) => {
    const supplier = suppliers.find((entry) => entry.id === supplierId);
    setRows((current) => {
      const target = current.find((row) => row.key === rowKey);
      if (!target) return current;
      if (supplier && current.some((row) => (
        row.key !== rowKey
        && rowItemKey(row) === rowItemKey(target)
        && rowSupplierKey(row) === supplier.id
      ))) {
        toast.error(tr(
          "هذا المنتج والمورد مضافان بالفعل داخل المقارنة",
          "This product and supplier are already in the comparison",
        ));
        return current;
      }
      return current.map((row) => row.key === rowKey ? {
        ...row,
        supplier_id: supplier?.id || "",
        supplier_code: supplier?.code || "",
        supplier_name: supplier?.name || "",
        manual_supplier_key: "",
        selected_for_purchase: 0,
      } : row);
    });
  };
 const deleteRow = (key) =>
  setRows((current) =>
    current.filter((row) => row.key !== key)
  );
  const duplicateRow = (row) => {
  const copy = {
    ...row,
    key: globalThis.crypto?.randomUUID?.() || `row-${Date.now()}`,
    id: undefined,
    supplier_id: "",
    supplier_code: "",
    supplier_name: "",
    manual_supplier_key: "",
    selected_for_purchase: 0,
    entry_mode: row.item_id ? "system" : "manual",
  };

  setEditingKey("");
  setDraft(copy);
  setOfferOpen(true);
};

  const selectForPurchase = (targetRow) => {
    if (!targetRow.eligible) {
      toast.error(tr(
        "لا يمكن اختيار عرض غير مكتمل أو غير صالح للشراء",
        "Incomplete or invalid offers cannot be selected for purchase",
      ));
      return;
    }
    const targetItemKey = rowItemKey(targetRow);

  setRows((current) =>
    current.map((row) => ({
      ...row,
      selected_for_purchase:
        rowItemKey(row) === targetItemKey
          ? (row.key === targetRow.key ? 1 : 0)
          : Number(row.selected_for_purchase || 0),
    })),
  );
  };

  const selectSupplierOffer = (group, cheapestSelection = false) => {
    if (!group.summary?.is_complete) {
      toast.error(tr("لا يمكن اختيار عرض غير مكتمل", "An incomplete offer cannot be selected"));
      return;
    }
    const quotation = supplierQuotations.find((item) => (
      (item.supplier_id && item.supplier_id === group.key)
      || item.supplier_name === group.supplierName
    ));
    if (quotation && quotation.status !== "received") {
      toast.error(tr("لا يمكن اختيار عرض مسودة أو منسحب", "Draft or withdrawn quotations cannot be selected"));
      return;
    }
    // Selection must always cover the supplier's full quotation, regardless
    // of any UI filter currently hiding rows from the detailed table.
    const fullSupplierRows = calculations.rows.filter((row) => rowSupplierKey(row) === group.key);
    const selectedByItem = new Map(fullSupplierRows.filter((row) => row.eligible).map((row) => [rowItemKey(row), row.key]));
    setRows((current) => current.map((row) => {
      const selectedKey = selectedByItem.get(rowItemKey(row));
      if (!selectedKey) return row;
      return { ...row, selected_for_purchase: row.key === selectedKey ? 1 : 0 };
    }));
    toast.success(cheapestSelection ? tr(
      `تم اختيار أرخص عرض كامل — ${group.supplierName} — الإجمالي ${formatMoney(group.summary.final_offer_total)}`,
      `Selected cheapest complete offer — ${group.supplierName} — total ${formatMoney(group.summary.final_offer_total)}`,
    ) : tr(
      `تم اختيار عرض ${group.supplierName} بإجمالي ${formatMoney(group.summary.final_offer_total)}`,
      `Selected ${group.supplierName}'s offer at ${formatMoney(group.summary.final_offer_total)}`,
    ));
  };

  const quotationForGroup = (group) => supplierQuotations.find((quotation) => (
    (quotation.supplier_id && quotation.supplier_id === group.key)
    || quotation.supplier_name === group.supplierName
  ));

  const cheapestSelectableGroup = [...supplierOfferGroups]
    .filter((group) => {
      if (!group.summary?.is_complete) return false;
      const quotation = quotationForGroup(group);
      return !quotation || quotation.status === "received";
    })
    .sort((left, right) => Number(left.summary.final_offer_total) - Number(right.summary.final_offer_total))[0] || null;

  const selectCheapestComplete = () => {
    if (!cheapestSelectableGroup) {
      toast.error(tr("لا يوجد عرض مورد كامل وصالح للاختيار", "No complete, valid supplier quotation is available"));
      return;
    }
    selectSupplierOffer(cheapestSelectableGroup, true);
  };

  const viewQuotationAttachment = async (attachment) => {
    try {
      const response = await api.get(attachment.download_url, { responseType: "blob" });
      const blob = response.data;
      if (!(blob instanceof Blob) || blob.size === 0) throw new Error("empty-attachment-response");
      const mediaType = attachment.media_type || blob.type;
      const url = URL.createObjectURL(blob);
      if (mediaType === "application/pdf" || (typeof mediaType === "string" && mediaType.startsWith("image/"))) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = attachment.original_filename || "attachment";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error(tr("تعذر فتح مرفق عرض المورد", "Could not open the supplier quotation attachment."));
    }
  };

  const uploadQuotationAttachments = async (quotation, files) => {
    if (!quotation || !files.length || !sourceRfqId) return;
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    try {
      const { data } = await api.post(
        `/workflow/rfqs/${sourceRfqId}/quotations/${quotation.id}/attachments`,
        form,
      );
      const additions = (data.attachments || []).map((attachment) => ({
        ...attachment,
        download_url: `/workflow/rfqs/${sourceRfqId}/quotations/${quotation.id}/attachments/${attachment.id}`,
      }));
      setSupplierQuotations((current) => current.map((item) => item.id === quotation.id
        ? { ...item, attachments: [...(item.attachments || []), ...additions], attachment_count: Number(item.attachment_count || 0) + additions.length }
        : item));
      toast.success(tr("تم رفع مرفق عرض المورد", "Supplier quotation attachment uploaded"));
    } catch (error) {
      toast.error(tr(errMsg(error), "Could not upload the supplier quotation attachment. Check the file type, size, and your permission."));
    }
  };

const toggleDetails = (key) => setExpandedRows((current) => {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
});

  const payload = () => {
    const project = projects.find((entry) => entry.name === projectName);
    const customer = customers.find((entry) => entry.name === customerName);
    const calculatedByKey = new Map(
      calculations.rows.map((row) => [row.key, row]),
    );
    return {
      project_id: project?.id || "",
      project_name: projectName,
      customer_id: customer?.id || "",
      customer_name: customerName,
      source_request_id: sourceRequestId,
      source_request_number: sourceRequestNumber,
      comparison_date: comparisonDate,
      notes,
      supplier_offers: supplierOfferGroups
        .filter((group) => group.supplierId || group.supplierName)
        .map((group) => {
          const offer = group.offer || {};
          return {
            supplier_id: group.supplierId || "",
            supplier_code: group.supplierCode || group.key,
            supplier_name: group.supplierName || "",
            discount_pct: Number(offer.discount_pct) || 0,
            tax_pct: Number(offer.tax_pct) || 0,
            shipping_cost: Number(offer.shipping_cost) || 0,
            other_cost: Number(offer.other_cost) || 0,
          };
        }),
      rows: rows.map((row) => Object.fromEntries(
        rowPayloadFields.map((field) => [
          field,
          field === "selected_for_purchase"
            ? (calculatedByKey.get(row.key)?.eligible
              ? Number(row.selected_for_purchase) || 0
              : 0)
            : numberFields.has(field)
              ? Number(row[field]) || 0
              : row[field] || "",
        ]),
      )),
    };
  };

  const validateComparison = () => {
    if (!comparisonDate) return tr("تاريخ المقارنة مطلوب", "Comparison date is required");
    if (!rows.length) return tr("أضف عرض سعر واحداً على الأقل", "Add at least one price offer");
    if (sourceRequestId && rows.some((row) => !row.supplier_id)) {
      return tr("اختر موردًا فعليًا لكل عمود قبل حفظ المقارنة", "Select a Supplier Master record for every column before saving");
    }
    return null;
  };

  const syncSupplierQuotations = async () => {
    if (!sourceRfqId || !sourceRfqItems.length) return;
    const updatedQuotations = [];
    for (const group of supplierOfferGroups.filter((entry) => entry.supplierId)) {
      let quotation = quotationForGroup(group);
      if (!quotation) quotation = await ensureSupplierQuotation(group.supplierId);
      if (!quotation) continue;
      const lines = sourceRfqItems.map((rfqItem) => {
        const row = group.rows.find((entry) => (
          entry.rfq_item_id === rfqItem.id
          || entry.source_request_item_id === rfqItem.source_request_item_id
          || (entry.item_id && entry.item_id === rfqItem.item_id)
          || entry.product_name === rfqItem.product_name
        ));
        return row ? {
          rfq_item_id: rfqItem.id,
          quantity: Number(row.quantity || rfqItem.quantity || 0),
          unit: row.unit || rfqItem.unit || "",
          unit_price: Number(row.unit_price || 0),
          discount_pct: 0,
          tax_pct: 0,
          availability: row.availability || "available",
          remark: row.notes || "",
        } : null;
      });
      const completeEntry = lines.every((line) => (
        line && (line.availability === "unavailable" || line.unit_price > 0)
      ));
      const first = group.rows[0] || {};
      const { data } = await api.put(
        `/workflow/rfqs/${sourceRfqId}/quotations/${quotation.id}`,
        {
          quotation_ref: quotation.quotation_ref || "",
          quotation_date: quotation.quotation_date || comparisonDate,
          valid_until: first.price_valid_until || quotation.valid_until || "",
          payment_terms: first.payment_terms || quotation.payment_terms || "",
          delivery_terms: quotation.delivery_terms || "",
          currency: quotation.currency || "EGP",
          notes: quotation.notes || "",
          status: completeEntry ? "received" : "draft",
          lines: lines.filter(Boolean),
        },
      );
      updatedQuotations.push(data);
    }
    if (updatedQuotations.length) {
      setSupplierQuotations((current) => [
        ...current.filter((item) => !updatedQuotations.some((updated) => updated.id === item.id)),
        ...updatedQuotations,
      ]);
    }
  };
  const applyDetail = (detail) => {
    savedFingerprintRef.current = comparisonFingerprint({
      projectName: detail.project_name,
      customerName: detail.customer_name,
      comparisonDate: detail.comparison_date,
      notes: detail.notes,
      rows: detail.rows,
      supplierOffers: detail.supplier_offers || [],
    });
    setComparisonId(detail.id);
    setComparisonNumber(detail.comparison_number);
    setProjectName(detail.project_name || "");
    setCustomerName(detail.customer_name || "");
    setSourceRequestId(detail.source_request_id || "");
    setSourceRequestNumber(detail.source_request_number || "");
    setSourceAttachments(detail.source_attachments || []);
    setSourceRfqId(detail.source_rfq_id || "");
    setSourceRfqNumber(detail.source_rfq_number || "");
    setSupplierQuotations(detail.supplier_quotations || []);
    setComparisonDate(detail.comparison_date);
    setNotes(detail.notes || "");
    setRows(detail.rows.map((row) => ({
      ...row,
      key: row.id || globalThis.crypto?.randomUUID?.(),
      entry_mode: isManualRow(row) ? "manual" : "system",
    })));
    setSupplierOffers(detail.supplier_offers || []);
  };
  const save = async () => {
    const error = validateComparison();
    if (error) { toast.error(error); return; }
    setSaving(true);
    try {
      await syncSupplierQuotations();
      const response = comparisonId
        ? await api.put(`/price-comparisons/${comparisonId}`, payload())
        : await api.post("/price-comparisons", payload());
      applyDetail(response.data);
      toast.success(tr(
        `تم حفظ المقارنة ${response.data.comparison_number} بنجاح`,
        `Comparison ${response.data.comparison_number} saved successfully`,
      ));
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setSaving(false);
    }
  };
  const openSaved = async () => {
    try {
      const response = await api.get("/price-comparisons");
      setSaved(response.data);
      setSavedOpen(true);
    } catch (error) { toast.error(errMsg(error)); }
  };
  const loadComparison = async (id) => {
    if (hasUnsavedChanges && !window.confirm(tr(
      "سيتم فقد التغييرات غير المحفوظة. هل تريد فتح المقارنة المحفوظة؟",
      "Unsaved changes will be lost. Do you want to open the saved comparison?",
    ))) return;
    try {
      const response = await api.get(`/price-comparisons/${id}`);
      applyDetail(response.data);
      setSavedOpen(false);
    } catch (error) { toast.error(errMsg(error)); }
  };
  const deleteComparison = async (id = comparisonId) => {
    if (!id) return;
    if (!window.confirm(tr(
      "هل تريد حذف مسودة المقارنة؟ لا يمكن حذف مقارنة مرتبطة باعتماد أو أمر شراء.",
      "Delete this draft comparison? Comparisons linked to an approval or PO cannot be deleted.",
    ))) return;
    setDeleting(true);
    try {
      const { data } = await api.delete(`/price-comparisons/${id}`);
      toast.success(tr(`تم حذف ${data.comparison_number}`, `${data.comparison_number} deleted`));
      setSaved((current) => current.filter((item) => item.id !== id));
      if (id === comparisonId) {
        savedFingerprintRef.current = currentFingerprint;
        reset();
      }
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setDeleting(false);
    }
  };
  useEffect(() => {
    const requestedId = location.state?.comparison_id;
    if (requestedId && requestedId !== comparisonId) loadComparison(requestedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state?.comparison_id]);
  const exportExcel = async () => {
    if (!comparisonId) { toast.error(tr("احفظ المقارنة أولاً قبل التصدير", "Save the comparison before exporting")); return; }
    try {
      const response = await api.get(
        `/price-comparisons/${comparisonId}/export.xlsx`, { responseType: "blob" },
      );
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `supplier-price-comparison-${comparisonNumber}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) { toast.error(errMsg(error)); }
  };

  const openAddToCatalog = (item) => {
    setCatalogTarget(item);
    setCatalogForm({
      name: item.product_name || "", unit: item.unit || "",
      main_category: item.main_category || "", subcategory: item.subcategory || "",
    });
  };
  const submitAddToCatalog = async () => {
    if (!catalogTarget) return;
    if (!catalogForm.name.trim() || !catalogForm.unit.trim()) {
      toast.error(tr("اسم الصنف والوحدة مطلوبان", "Item name and unit are required"));
      return;
    }
    setSavingCatalog(true);
    try {
      const { data } = await api.post("/items", {
        name: catalogForm.name.trim(),
        product_name: catalogForm.name.trim(),
        main_category: catalogForm.main_category.trim(),
        subcategory: catalogForm.subcategory.trim(),
        unit: catalogForm.unit.trim(),
        brand: catalogTarget.brand || "",
        specifications: catalogTarget.specifications || "",
      });
      setItems((current) => [...current, data]);
      const targetKey = catalogTarget.itemKey;
      setRows((current) => current.map((row) => (
        rowItemKey(row) === targetKey
          ? { ...row, item_id: data.id, item_code: data.code, manual_product_key: "" }
          : row
      )));
      toast.success(tr(`تم إضافة الصنف للدليل — ${data.code}`, `Item added to catalog — ${data.code}`));
      setCatalogTarget(null);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setSavingCatalog(false);
    }
  };

  const requestSaveToMaster = (kind) => {
    if (kind === "supplier" && !draft.supplier_name.trim()) {
      toast.error(tr("أدخل اسم المورد أولاً", "Enter the supplier name first")); return;
    }
    if (kind === "item" && !draft.product_name.trim()) {
      toast.error(tr("أدخل اسم المنتج أولاً", "Enter the product name first")); return;
    }
    setConfirmation(kind);
  };
  const confirmSaveToMaster = async () => {
    setSavingMaster(true);
    try {
      if (confirmation === "supplier") {
        const response = await api.post("/suppliers", { name: draft.supplier_name.trim() });
        setSuppliers((current) => [...current, response.data]);
        setDraft((current) => ({
          ...current,
          supplier_id: response.data.id,
          supplier_code: response.data.code,
          supplier_name: response.data.name,
        }));
        toast.success(tr("تم حفظ المورد في الموردين", "Supplier saved to suppliers"));
      } else if (confirmation === "item") {
        const response = await api.post("/items", {
          name: draft.product_name.trim(),
          product_name: draft.product_name.trim(),
          brand: draft.brand,
          main_category: draft.main_category,
          subcategory: draft.subcategory,
          specifications: draft.specifications,
          unit: draft.unit,
        });
        setItems((current) => [...current, response.data]);
        setDraft((current) => selectItem(current, response.data));
        toast.success(tr("تم حفظ المنتج في الأصناف", "Product saved to items"));
      }
      setConfirmation("");
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setSavingMaster(false);
    }
  };

  const scenario = calculations.scenario_summary;
  const selectedPurchaseRows = calculations.rows.filter(
  (row) => row.eligible && Number(row.selected_for_purchase || 0) === 1,
);

const selectedPurchaseItemCount = new Set(
  selectedPurchaseRows.map((row) => rowItemKey(row)),
).size;

const selectedPurchaseSupplierCount = new Set(
  selectedPurchaseRows.map((row) => rowSupplierKey(row)).filter(Boolean),
).size;

const selectedPurchaseGroups = selectedPurchaseRows.reduce((groups, row) => {
  const key = rowSupplierKey(row);
  (groups[key] ||= []).push(row);
  return groups;
}, {});
const selectedPurchaseTotal = Object.entries(selectedPurchaseGroups).reduce(
  (sum, [key, selectedRows]) => sum + calculateSupplierTotal(
    selectedRows.reduce((subtotal, row) => subtotal + Number(row.subtotal || 0), 0),
    supplierOffers.find((offer) => rowSupplierKey(offer) === key) || {},
  ).final_offer_total,
  0,
);

const allComparisonItemsCount = new Set(
  calculations.rows.map((row) => rowItemKey(row)).filter(Boolean),
).size;

const suppliersInComparisonCount = supplierOfferGroups.filter((group) => group.supplierId).length;

const selectedSupplierName = selectedPurchaseSupplierCount === 1
  ? (selectedPurchaseRows[0]?.supplier_name || "")
  : "";

const mixedSelectionBreakdown = selectedPurchaseSupplierCount > 1
  ? [...selectedPurchaseRows.reduce((map, row) => {
      const name = row.supplier_name || tr("مورد غير محدد", "Unassigned supplier");
      map.set(name, (map.get(name) || 0) + 1);
      return map;
    }, new Map()).entries()]
  : [];
  const sendForApproval = async () => {
    if (!comparisonId) return toast.error(tr("احفظ المقارنة أولاً", "Save the comparison first"));
    if (hasUnsavedChanges) return toast.error(tr("احفظ الاختيارات الحالية أولاً", "Save the current selections first"));
    if (!selectedPurchaseRows.length) return toast.error(tr("اختر عرضًا صالحًا واحدًا على الأقل", "Select at least one valid offer"));
    if (supplierOfferGroups.some((group) => !group.supplierId)) return toast.error(tr("اختر موردًا فعليًا لكل عمود", "Select a Supplier Master record for every column"));
    if (selectedPurchaseItemCount !== allComparisonItemsCount) return toast.error(tr("اختر عرضًا صالحًا لكل صنف قبل الإرسال", "Select one valid offer for every item before sending"));
    try {
      const { data } = await api.post("/workflow/approvals/from-comparison", {
        comparison_id: comparisonId,
        created_by: "",
        approval_type: "comparison_workflow",
      });
      toast.success(tr(`أُرسلت المقارنة للمراجعة والاعتماد — ${data.approval.approval_number}`, `Sent for review and approval — ${data.approval.approval_number}`));
      navigate("/approvals", { state: { approval_id: data.approval.id } });
    } catch (error) { toast.error(errMsg(error)); }
  };
  return (
    <div className="relative isolate space-y-1.5 supplier-comparison-page" data-testid="supplier-price-comparison-page">
      <div className="flex h-[calc(100dvh-69px)] min-h-[520px] flex-col gap-1.5" data-testid="comparison-workspace">
      <section className="shrink-0 border bg-card px-2 py-1 print:border-0 print:p-0" data-testid="comparison-command-bar">
        <div className="flex flex-wrap items-center justify-between gap-1.5 sm:flex-nowrap">
          <div className="flex min-w-0 w-full flex-1 flex-wrap items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground sm:w-auto sm:flex-nowrap sm:whitespace-nowrap">
            <h1 className="sr-only">{tr("مقارنة أسعار الموردين", "Supplier price comparison")}</h1>
            <span className="border bg-muted px-1.5 py-0.5 font-mono font-bold text-foreground" dir="ltr">{comparisonNumber || tr("CMP جديد", "New CMP")}</span>
            <span className="hidden font-mono sm:inline" dir="ltr">REQ: <b className="text-foreground">{sourceRequestNumber || "-"}</b></span>
            <span className="hidden font-mono lg:inline" dir="ltr">RFQ: <b className="text-foreground">{sourceRfqNumber || (sourceRfqId ? sourceRfqId : "-")}</b></span>
            <span className="max-w-48 truncate">{tr("المشروع", "Project")}: <b className="text-foreground">{projectName || "-"}</b></span>
            <StatusBadge tone={hasUnsavedChanges ? "warning" : comparisonId ? "success" : "neutral"}>{hasUnsavedChanges ? tr("تغييرات غير محفوظة", "Unsaved changes") : comparisonId ? tr("مسودة محفوظة", "Saved draft") : tr("مسودة جديدة", "New draft")}</StatusBadge>
            <span className="border border-primary/20 bg-primary/5 px-1.5 py-0.5 font-semibold text-primary" data-testid="compact-workflow" title={direction === "rtl" ? "REQ ← RFQ ← CMP ← APR ← PO ← استلام" : "REQ → RFQ → CMP → APR → PO → Receiving"}>{tr("المرحلة: المقارنة", "Stage: Comparison")}</span>
            <details className="relative comparison-print-hidden">
              <summary className="cursor-pointer select-none px-1 py-0.5 font-semibold text-primary">{tr("بيانات المقارنة", "Comparison settings")}</summary>
              <div className="absolute start-0 top-full z-50 mt-1 grid w-[min(46rem,calc(100vw-2rem))] grid-cols-1 gap-2 border bg-card p-2 shadow-lg sm:grid-cols-2 lg:grid-cols-4">
                <FormField label={tr("المشروع — اختياري", "Project — optional")}><Input className="h-8" list="comparison-projects" value={projectName} onChange={(event) => setProjectName(event.target.value)} /><datalist id="comparison-projects">{projects.map((row) => <option key={row.id} value={row.name} />)}</datalist></FormField>
                <FormField label={tr("العميل — اختياري", "Customer — optional")}><Input className="h-8" list="comparison-customers" value={customerName} onChange={(event) => setCustomerName(event.target.value)} /><datalist id="comparison-customers">{customers.map((row) => <option key={row.id} value={row.name} />)}</datalist></FormField>
                <FormField label={tr("تاريخ المقارنة *", "Comparison date *")}><Input className="h-8" type="date" value={comparisonDate} onChange={(event) => setComparisonDate(event.target.value)} /></FormField>
                <FormField label={tr("ملاحظات", "Notes")}><Textarea className="min-h-8" rows={1} value={notes} onChange={(event) => setNotes(event.target.value)} /></FormField>
              </div>
            </details>
          </div>
          <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-1.5 comparison-actions comparison-print-hidden sm:w-auto sm:flex-nowrap">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={reset} title={tr("مقارنة جديدة", "New comparison")}><FilePlus2 className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={openSaved} title={tr("فتح مقارنة", "Open comparison")}><FolderOpen className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={exportExcel} title={tr("تصدير Excel", "Export Excel")}><Download className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" data-testid="comparison-print" onClick={() => window.print()} title={tr("طباعة", "Print")}><Printer className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant={hasUnsavedChanges || !comparisonId ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={save} disabled={saving} data-testid="comparison-save"><Save className="h-3.5 w-3.5" />{saving ? tr("جارٍ الحفظ", "Saving") : tr("حفظ", "Save")}</Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={selectCheapestComplete} data-testid="select-cheapest-complete-offer">{tr("اختيار الأرخص كاملًا", "Choose cheapest complete")}</Button>
            <Button size="sm" variant={comparisonId && !hasUnsavedChanges && selectedPurchaseItemCount === allComparisonItemsCount && allComparisonItemsCount > 0 ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={sendForApproval} data-testid="comparison-send"><Send className="h-3.5 w-3.5" />{tr("إرسال للاعتماد", "Send for approval")}</Button>
            {comparisonId && <div className="relative"><Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={tr("مزيد من الإجراءات", "More actions")} onClick={() => setMoreMenuOpen((value) => !value)} data-testid="comparison-more-actions"><MoreHorizontal className="h-4 w-4" /></Button>{moreMenuOpen && <div className="absolute end-0 z-30 mt-1 w-52 border bg-card p-1 shadow-md" data-testid="comparison-more-menu"><button type="button" className="flex w-full items-center gap-2 px-2 py-1.5 text-start text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50" disabled={deleting} onClick={() => { setMoreMenuOpen(false); deleteComparison(); }} data-testid="delete-comparison"><Trash2 className="h-3.5 w-3.5" />{deleting ? tr("جارٍ الحذف", "Deleting") : tr("حذف مسودة المقارنة", "Delete draft comparison")}</button></div>}</div>}
          </div>
        </div>
      </section>
      {(sourceRequest || sourceAttachments.length > 0) && (
      <details className="border bg-card comparison-print-hidden" data-testid="source-context">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-1.5">
          <span className="flex min-w-0 items-center gap-1.5 text-[10.5px] font-semibold text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-primary" />
            {tr("مصدر المقارنة", "Comparison source")}
            {sourceRequest && <><span>·</span><span className="font-mono text-foreground" dir="ltr">{sourceRequest.request_number}</span><span>· {(sourceRequest.items || []).filter((item) => item.review_status === "approved").length} {tr("صنف مؤهل", "eligible items")}</span></>}
            {!!sourceAttachments.length && <span>· {sourceAttachments.length} {tr("مرفق", "attachments")}</span>}
          </span>
          {sourceRequest && <Button type="button" size="sm" className="h-6 px-2 text-[10.5px]" onClick={(event) => { event.preventDefault(); addAllSourceRequestItems(); }} data-testid="add-all-request-items"><Plus className="h-3.5 w-3.5" />{tr("إضافة الكل", "Add all")}</Button>}
        </summary>
        <div className="border-t">
          {!!sourceAttachments.length && <div className="grid gap-2 border-b p-2 lg:grid-cols-2" data-testid="source-request-attachments">
            <div className="lg:col-span-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{tr("مرفقات طلب الشراء", "Purchase request attachments")}</div>
            {sourceAttachments.map((attachment) => <RequestAttachmentCard key={attachment.id} attachment={attachment} tr={tr} />)}
          </div>}
          {sourceRequest && <div className="overflow-x-auto" data-testid="source-request-items-table">
      <table className="w-full min-w-[760px] text-xs">
        <thead className="bg-muted/70"><tr><th className="p-2 text-start">#</th><th className="p-2 text-start">{tr("الصنف", "Item")}</th><th className="p-2 text-start">{tr("المواصفات", "Specification")}</th><th className="p-2 text-center">{tr("الكمية", "Qty")}</th><th className="p-2 text-center">{tr("الوحدة", "Unit")}</th><th className="p-2 text-center">{tr("المراجعة", "Review")}</th><th className="p-2 text-center">{tr("حالة المقارنة", "Comparison")}</th><th className="p-2 text-end">{tr("الإجراء", "Action")}</th></tr></thead>
        <tbody>{(sourceRequest.items || []).map((item) => {
          const eligible = item.review_status === "approved";
          const alreadyAdded = rows.some((row) => row.source_request_item_id === item.id);
          const reviewLabel = item.review_status === "approved" ? tr("معتمد", "Approved") : item.review_status === "rejected" ? tr("مرفوض", "Rejected") : item.review_status === "need_clarification" ? tr("يحتاج استكمال", "Needs Completion") : tr("غير مؤهل", "Not eligible");
          return <tr key={item.id} className="border-t hover:bg-muted/30"><td className="p-2">{item.position}</td><td className="p-2 font-semibold">{item.product_name}</td><td className="max-w-64 truncate p-2 text-muted-foreground" title={item.specifications}>{item.specifications || "-"}</td><td className="p-2 text-center tabular-nums">{item.quantity}</td><td className="p-2 text-center">{item.unit}</td><td className="p-2 text-center"><StatusBadge tone={eligible ? "success" : item.review_status === "rejected" ? "danger" : "warning"}>{reviewLabel}</StatusBadge></td><td className="p-2 text-center">{alreadyAdded ? tr("مضاف", "Added") : eligible ? tr("جاهز", "Ready") : tr("مستبعد", "Excluded")}</td><td className="p-2 text-end"><Button type="button" size="sm" variant="outline" disabled={!eligible || alreadyAdded} onClick={() => addSourceRequestItem(item)} data-testid={`add-request-item-${item.id}`}><Plus className="h-3.5 w-3.5" />{tr("إضافة للمقارنة", "Add to comparison")}</Button></td></tr>;
        })}</tbody>
      </table>
          </div>}
        </div>
      </details>
      )}

      <section className="flex min-h-0 flex-1 flex-col border bg-card p-1" data-testid="added-offers-section">
        <div className="relative flex shrink-0 flex-wrap items-center gap-1 border-b pb-1">
          <h2 className="me-auto text-xs font-bold text-foreground">{tr("مصفوفة الأسعار", "Price matrix")} <span className="font-normal text-muted-foreground">· {allComparisonItemsCount} {tr("صنف", "items")} · {suppliersInComparisonCount} {tr("مورد", "suppliers")}</span></h2>
          <div className="flex flex-wrap items-center gap-1 comparison-print-hidden">
            {!sourceRequest && <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => openNewOffer("manual")} data-testid="comparison-add-manual-product"><PackagePlus className="h-3.5 w-3.5" />{tr("بند يدوي", "Manual line")}</Button>}
            <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setShowDetailedTable((value) => !value)}>{showDetailedTable ? tr("إخفاء الجدول", "Hide table") : tr("جدول تفصيلي", "Detailed table")}</Button>
            <details className="relative" data-testid="advanced-filters">
              <summary className="flex h-7 cursor-pointer list-none select-none items-center gap-1 border bg-background px-2 text-xs font-semibold text-muted-foreground hover:bg-muted"><SlidersHorizontal className="h-3.5 w-3.5" />{tr("الفلاتر", "Filters")}<span className="font-mono" dir="ltr">({[search, productFilter, supplierFilter, categoryFilter, subcategoryFilter, brandFilter, availabilityFilter].filter(Boolean).length})</span></summary>
              <div className="absolute end-0 top-full z-40 mt-1 grid w-[min(58rem,calc(100vw-2rem))] grid-cols-2 gap-2 border bg-card p-2 shadow-lg md:grid-cols-4 xl:grid-cols-7">
                <Input className="h-8 text-xs" placeholder={tr("بحث بالصنف أو المورد...", "Search item or supplier...")} value={search} onChange={(event) => setSearch(event.target.value)} />
                <select className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs" value={productFilter} onChange={(event) => setProductFilter(event.target.value)}>
                  <option value="">{tr("كل المنتجات", "All products")}</option>{productFilterOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <select className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs" value={supplierFilter} onChange={(event) => { setSupplierFilter(event.target.value); setSupplierPage(0); }}><option value="">{tr("كل الموردين", "All suppliers")}</option>{supplierFilterOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                <select data-testid="offers-category-filter" className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs" value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setSubcategoryFilter(""); setBrandFilter(""); }}>
                  <option value="">{tr("كل التصنيفات الرئيسية", "All main categories")}</option>{offerClassificationOptions.categories.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
                <select data-testid="offers-subcategory-filter" className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs" value={subcategoryFilter} disabled={!categoryFilter} onChange={(event) => { setSubcategoryFilter(event.target.value); setBrandFilter(""); }}>
                  <option value="">{tr("كل التصنيفات الفرعية", "All subcategories")}</option>{offerClassificationOptions.subcategories.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
                <select data-testid="offers-brand-filter" className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs" value={brandFilter} disabled={!subcategoryFilter} onChange={(event) => setBrandFilter(event.target.value)}>
                  <option value="">{tr("كل العلامات", "All brands")}</option>{offerClassificationOptions.brands.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
                <select className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs" value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value)}><option value="">{tr("كل حالات التوفر", "All availability")}</option><option value="available">{tr("متاح", "Available")}</option><option value="unavailable">{tr("غير متاح", "Unavailable")}</option></select>
                <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => { setSearch(""); setProductFilter(""); setSupplierFilter(""); setCategoryFilter(""); setSubcategoryFilter(""); setBrandFilter(""); setAvailabilityFilter(""); setSupplierPage(0); }}>{tr("مسح الفلاتر", "Clear filters")}</Button>
              </div>
            </details>
            <Button type="button" size="sm" variant="outline" className="h-7" onClick={addSupplierColumn} data-testid="add-supplier-column"><Plus className="h-3.5 w-3.5" />{tr("إضافة مورد", "Add supplier")}</Button>
            <div className="flex h-7 items-center gap-0.5 border bg-card px-0.5" data-testid="supplier-pager"><Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={supplierPage === 0} onClick={() => setSupplierPage((page) => page - 1)} aria-label={tr("الموردون السابقون", "Previous suppliers")}>{direction === "rtl" ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}</Button><span className="min-w-20 text-center text-[10.5px] text-muted-foreground" dir="ltr">{filteredSupplierGroups.length ? supplierPage * 3 + 1 : 0}–{Math.min((supplierPage + 1) * 3, filteredSupplierGroups.length)} {tr("من", "of")} {filteredSupplierGroups.length}</span><Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={supplierPage + 1 >= supplierPageCount} onClick={() => setSupplierPage((page) => page + 1)} aria-label={tr("الموردون التاليون", "Next suppliers")}>{direction === "rtl" ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</Button></div>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col pt-1" data-testid="vertical-offer-cards">
          {visibleSupplierGroups.length && filteredItemOrder.length ? <ComparisonMatrix itemOrder={filteredItemOrder} visibleSupplierGroups={visibleSupplierGroups} tr={tr} formatMoney={formatMoney} onPrice={(keyValue, value) => updateRowField(keyValue, "unit_price", value)} onSelectRow={selectForPurchase} onSelectSupplier={selectSupplierOffer} onEdit={editRow} onDelete={deleteRow} quotationForGroup={quotationForGroup} canUpload={canUploadQuotation} onUpload={uploadQuotationAttachments} onViewAttachment={viewQuotationAttachment} cheapestSelectableGroup={cheapestSelectableGroup} supplierOptions={supplierOptions} onAssignSupplier={assignSupplierToGroup} onAdjustment={updateSupplierAdjustment} lastSupplierPrices={lastSupplierPrices} onAddToCatalog={openAddToCatalog} /> : <EmptyState compact title={tr("لا توجد عروض مطابقة", "No matching offers")} description={rows.length ? tr("غيّر الفلاتر لعرض المصفوفة.", "Adjust the filters to show the matrix.") : tr("أضف الأصناف المؤهلة ثم اختر المورد لكل عمود.", "Add eligible items, then select a supplier for each column.")} />}
        </div>
        {showDetailedTable && <div className="mt-1 max-h-[42%] shrink-0 overflow-auto border" data-testid="detailed-offers-table">
          <table className="w-full table-fixed text-xs">
            <thead className="bg-muted text-muted-foreground"><tr>
              <th className="w-[18%] p-2 text-start">{tr("المنتج", "Product")}</th><th className="w-[16%] p-2 text-start">{tr("المورد", "Supplier")}</th>
              <th className="w-[8%] p-2">{tr("الكمية", "Quantity")}</th><th className="w-[11%] p-2">{tr("سعر الوحدة", "Unit price")}</th>
              <th className="w-[13%] p-2">{tr("الإجمالي النهائي", "Final total")}</th><th className="w-[9%] p-2">{tr("التسليم", "Delivery")}</th>
              <th className="w-[9%] p-2">{tr("التوفر", "Availability")}</th><th className="w-[15%] p-2 comparison-print-hidden">{tr("الإجراءات", "Actions")}</th>
            </tr></thead>
            <tbody>{filteredRows.map((row) => {
              const statusClass = row.selected_for_purchase
              ? "bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/30"
              : row.is_incomplete
                ? "bg-amber-500/10"
                : row.is_unavailable
                ? "bg-destructive/10"
                : row.is_expired || row.is_missing_price
                  ? "bg-orange-500/10"
                  : row.is_lowest_final_total
                    ? "bg-emerald-500/10"
                    : row.is_fastest_delivery
                      ? "bg-blue-500/10"
                      : "";
                       return [
                <tr key={row.key} className={`border-t ${statusClass}`} data-testid="comparison-row">
                  <td className="p-2"><div className="truncate font-medium" title={row.product_name}>{row.product_name}</div><div className="truncate text-[10px] text-muted-foreground" title={row.brand}>{row.brand || tr("بدون علامة", "No brand")}</div></td>
                  <td className="p-2">
                  <select
                    value={row.supplier_id || ""}
                    onChange={(event) =>
                      updateRowSupplier(row.key, event.target.value)
                    }
                    data-testid={`inline-supplier-${row.key}`}
                    className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                  >
                    <option value="">
                      {row.supplier_name
                        ? tr(`يدوي — ${row.supplier_name}`, `Manual — ${row.supplier_name}`)
                        : tr("اختر المورد...", "Select supplier...")}
                    </option>

                    {suppliers.map((supplier) => (
                      <option
                        key={supplier.id}
                        value={supplier.id}
                      >
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                  {row.is_incomplete && <div className="mt-1 text-[10px] font-bold text-amber-700" data-testid={`incomplete-offer-${row.key}`}>
                    {tr("عرض غير مكتمل", "Incomplete offer")}
                  </div>}
                </td>
                  <td className="p-2 text-center">{fmt(row.quantity)}</td>
                  <td className="p-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.unit_price || ""}
                    placeholder="0.00"
                    className="h-8 text-center text-xs"
                    data-testid={`inline-unit-price-${row.key}`}
                    onChange={(event) =>
                      updateRowField(
                        row.key,
                        "unit_price",
                        event.target.value
                      )
                    }
                  />
                </td>
                  <td className={`p-2 text-center font-bold ${row.is_lowest_final_total ? "text-emerald-700" : ""}`}>{formatMoney(row.final_total)}</td>
                  <td className={`p-2 text-center ${row.is_fastest_delivery ? "text-blue-700 dark:text-blue-300" : ""}`}>{row.delivery_days} {tr("يوم", "days")}</td>
                  <td className="p-2 text-center">{row.availability === "available" ? tr("متاح", "Available") : tr("غير متاح", "Unavailable")}</td>
                  <td className="p-1 comparison-print-hidden"><div className="flex items-center justify-center gap-0.5">
                  <Button
                    size="sm"
                    variant={row.selected_for_purchase ? "default" : "outline"}
                    className="h-7 px-2 text-[10px]"
                    disabled={!row.eligible}
                    onClick={() => selectForPurchase(row)}
                  >
                    {row.selected_for_purchase
                      ? tr("مختار", "Selected")
                      : row.is_incomplete
                        ? tr("عرض غير مكتمل", "Incomplete offer")
                        : row.is_unavailable
                        ? tr("غير متاح", "Unavailable")
                        : row.is_expired
                          ? tr("السعر منتهي", "Expired")
                          : row.is_missing_price
                            ? tr("بدون سعر", "No price")
                            : tr("اختيار للشراء", "Select")}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title={tr("عرض التفاصيل", "Show details")} onClick={() => toggleDetails(row.key)}><ChevronDown className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title={tr("تعديل", "Edit")} data-testid={`edit-offer-${row.key}`} onClick={() => editRow(row)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title={tr("تكرار", "Duplicate")} data-testid={`duplicate-offer-${row.key}`} onClick={() => duplicateRow(row)}><Copy className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title={tr("حذف", "Delete")} data-testid={`delete-offer-${row.key}`} onClick={() => deleteRow(row.key)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div></td>
                </tr>,
                expandedRows.has(row.key) && <tr key={`details-${row.key}`} className="border-t bg-muted/40"><td colSpan={8} className="p-3">
                  <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
                    <span><b>{tr("الكود:", "Code:")}</b> {row.item_code || tr("يدوي", "Manual")}</span><span><b>{tr("الوحدة:", "Unit:")}</b> {row.unit || "-"}</span>
                    <span><b>{tr("التصنيف:", "Category:")}</b> {row.main_category || "-"} / {row.subcategory || "-"}</span><span title={row.specifications}><b>{tr("المواصفات:", "Specifications:")}</b> {row.specifications || "-"}</span>
                    <span><b>{tr("فرق أقل إجمالي بند:", "Difference from lowest item total:")}</b> {row.difference_from_lowest == null ? "-" : `${formatMoney(row.difference_from_lowest)} (${fmt(row.difference_pct_from_lowest)}%)`}</span>
                    <span><b>{tr("آخر سعر شراء:", "Last purchase price:")}</b> {row.last_historical_unit_price == null ? "-" : formatMoney(row.last_historical_unit_price)}</span><span><b>{tr("الفرق التاريخي:", "Historical difference:")}</b> {row.difference_from_last_price == null ? "-" : `${formatMoney(row.difference_from_last_price)} (${fmt(row.difference_pct_from_last_price)}%)`}</span>
                    <span><b>{tr("شروط الدفع:", "Payment terms:")}</b> {row.payment_terms || "-"}</span><span><b>{tr("صلاحية السعر:", "Price valid until:")}</b> {row.price_valid_until || "-"}</span>
                    <span className="md:col-span-2"><b>{tr("الملاحظات:", "Notes:")}</b> {row.notes || "-"}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2 comparison-print-hidden"
                    onClick={() => duplicateRow(row)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {tr("تكرار العرض", "Duplicate offer")}
                  </Button>
                              </td>
                            </tr> ,
                  ];
                  })}
            {!filteredRows.length && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">{tr("لا توجد عروض مضافة أو مطابقة", "No offers have been added or match the filters")}</td></tr>}</tbody>
          </table>
        </div>}
      </section>

      {!!rows.length && <div className="shrink-0 comparison-print-hidden" data-testid="comparison-summary-bar">
        <div className="flex min-h-9 w-full max-w-full items-center gap-2 overflow-hidden border border-primary/20 bg-card px-2 py-1 text-[11px]">
          <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain" data-testid="comparison-summary-metrics">
            <div className="flex w-max min-w-full items-center gap-x-3 whitespace-nowrap px-1">
              <span><span className="text-muted-foreground">{tr("الأصناف المختارة", "Selected items")}</span> <b className="tabular-nums">{selectedPurchaseItemCount}/{allComparisonItemsCount}</b></span>
              <span><span className="text-muted-foreground">{tr("الموردون المقارنون", "Compared suppliers")}</span> <b className="tabular-nums">{suppliersInComparisonCount}</b></span>
              <span><span className="text-muted-foreground">{tr("إجمالي الشراء المتوقع", "Expected purchase total")}</span> <b className="font-mono text-primary" dir="ltr">{formatMoney(selectedPurchaseTotal)}</b></span>
              {selectedSupplierName && <span className="text-muted-foreground">{tr("المورد", "Supplier")}: <b className="text-foreground">{selectedSupplierName}</b></span>}
              {selectedPurchaseSupplierCount > 1 && <span className="text-muted-foreground" title={mixedSelectionBreakdown.map(([name, count]) => `${name}: ${count}`).join(" · ")}>{tr(`اختيار مختلط من ${selectedPurchaseSupplierCount} موردين`, `Mixed selection from ${selectedPurchaseSupplierCount} suppliers`)}</span>}
            </div>
          </div>
          <Button type="button" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={sendForApproval} data-testid="comparison-summary-send"><Send className="h-3.5 w-3.5" />{tr("إرسال للاعتماد", "Send for approval")}</Button>
        </div>
      </div>}
      </div>

      {!!rows.length && <details className="comparison-summary border bg-card p-2">
        <summary className="cursor-pointer text-xs font-bold text-foreground">{tr("التحليل التفصيلي والتوفير", "Detailed analysis and savings")}</summary>
      <section className="mt-4 space-y-3" data-testid="comparison-results-section">
        <h3 className="text-sm font-bold text-foreground">{tr("3 — مقارنة المنتجات", "3 — Product comparison")}</h3>
        <div className="comparison-matrix overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[940px] text-xs"><thead className="bg-muted"><tr>
            <th className="p-2 text-start">{tr("المنتج", "Product")}</th><th className="p-2">{tr("أقل سعر وحدة", "Lowest unit price")}</th><th className="p-2">{tr("أقل إجمالي نهائي", "Lowest final total")}</th><th className="p-2">{tr("أسرع تسليم", "Fastest delivery")}</th><th className="p-2">{tr("آخر سعر شراء", "Last purchase price")}</th><th className="p-2">{tr("الفرق التاريخي", "Historical difference")}</th><th className="p-2">{tr("العروض المتاحة", "Available offers")}</th>
          </tr></thead><tbody>{calculations.product_summaries.map((row) => <tr key={row.item_id || row.item_code || `${row.product_name}-${row.brand}`} className="border-t">
            <td className="max-w-48 truncate p-2 font-medium" title={row.product_name}>{row.product_name}</td>
            <td className="p-2 text-center">{row.lowest_unit_price == null ? "-" : `${formatMoney(row.lowest_unit_price)} — ${row.lowest_unit_price_supplier}`}</td>
            <td className="p-2 text-center text-emerald-700 dark:text-emerald-300">{row.lowest_final_total == null ? "-" : `${formatMoney(row.lowest_final_total)} — ${row.lowest_final_total_supplier}`}</td>
            <td className="p-2 text-center text-blue-700 dark:text-blue-300">{row.fastest_delivery_days == null ? "-" : `${row.fastest_delivery_days} ${tr("يوم", "days")} — ${row.fastest_delivery_supplier}`}</td>
            <td className="p-2 text-center">{row.last_historical_unit_price == null ? "-" : formatMoney(row.last_historical_unit_price)}</td>
            <td className="p-2 text-center">{row.difference_from_last_price == null ? "-" : `${formatMoney(row.difference_from_last_price)} (${fmt(row.difference_pct_from_last_price)}%)`}</td>
            <td className="p-2 text-center">{row.available_offer_count}</td>
          </tr>)}{!calculations.product_summaries.length && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">{tr("أضف عروضاً لعرض مقارنة المنتجات", "Add offers to view the product comparison")}</td></tr>}</tbody></table>
        </div>
      </section>

      <section className="space-y-3 comparison-summary" data-testid="supplier-summary-section">
        <h3 className="text-sm font-bold text-foreground">{tr("4 — ملخص الموردين", "4 — Supplier summary")}</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Metric label={tr("أرخص عرض كامل", "Cheapest complete offer")} value={scenario.cheapest_complete_supplier?.supplier_name} accent="text-emerald-700 dark:text-emerald-300" />
          <Metric label={tr("أسرع عرض كامل", "Fastest complete offer")} value={scenario.fastest_complete_supplier?.supplier_name} accent="text-blue-700 dark:text-blue-300" />
          <Metric label={tr("أعلى توفر", "Highest availability")} value={scenario.highest_availability_supplier?.supplier_name} />
        </div>
        <div className="comparison-matrix overflow-x-auto rounded-lg border bg-card"><table className="min-w-[1220px] w-full text-xs"><thead className="bg-muted"><tr>
          <th className="p-2 text-start">{tr("المورد", "Supplier")}</th><th className="p-2">{tr("المنتجات", "Products")}</th><th className="p-2">{tr("المتاحة", "Available")}</th><th className="p-2">{tr("غير متاح", "Unavailable")}</th><th className="p-2">{tr("البنود", "Items")}</th><th className="p-2">{tr("الخصومات", "Discounts")}</th><th className="p-2">{tr("الضرائب", "Taxes")}</th><th className="p-2">{tr("الشحن", "Shipping")}</th><th className="p-2">{tr("أخرى", "Other")}</th><th className="p-2">{tr("الإجمالي", "Total")}</th><th className="p-2">{tr("التوفر", "Availability")}</th><th className="p-2">{tr("أقصى تسليم", "Maximum delivery")}</th><th className="p-2">{tr("فرق الأرخص", "Difference from lowest")}</th>
        </tr></thead><tbody>{calculations.supplier_summaries.map((row) => <tr key={row.supplier_id || row.supplier_code || row.supplier_name} className="border-t">
          <td className="max-w-48 truncate p-2 font-medium" title={row.supplier_name}>{row.supplier_name}</td><td className="p-2 text-center">{row.products_quoted}</td><td className="p-2 text-center">{row.available_products}</td><td className="p-2 text-center">{row.unavailable_products}</td><td className="p-2 text-center">{formatMoney(row.items_subtotal)}</td><td className="p-2 text-center">{formatMoney(row.total_discounts)}</td><td className="p-2 text-center">{formatMoney(row.total_taxes)}</td><td className="p-2 text-center">{formatMoney(row.total_shipping)}</td><td className="p-2 text-center">{formatMoney(row.total_other_costs)}</td><td className="p-2 text-center font-bold">{formatMoney(row.final_offer_total)}</td><td className="p-2 text-center">{fmt(row.availability_pct)}%</td><td className="p-2 text-center">{row.maximum_delivery_days ?? "-"}</td><td className="p-2 text-center">{row.difference_from_lowest_complete == null ? "-" : `${formatMoney(row.difference_from_lowest_complete)} (${fmt(row.difference_pct_from_lowest_complete)}%)`}</td>
        </tr>)}{!calculations.supplier_summaries.length && <tr><td colSpan={13} className="p-8 text-center text-muted-foreground">{tr("أضف عروضاً لعرض إجماليات الموردين", "Add offers to view supplier totals")}</td></tr>}</tbody></table></div>
      </section>

      <section className="space-y-3 comparison-summary" data-testid="mixed-savings-section">
        <h3 className="text-sm font-bold text-foreground">{tr("5 — ملخص الشراء المختلط والتوفير", "5 — Mixed purchase and savings summary")}</h3>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <Metric label={tr("إجمالي الشراء المختلط", "Mixed purchase total")} value={formatMoney(scenario.mixed_supplier_total)} />
          <Metric label={tr("أرخص عرض كامل", "Cheapest complete offer")} value={scenario.single_supplier_total == null ? "-" : formatMoney(scenario.single_supplier_total)} accent="text-emerald-700 dark:text-emerald-300" />
          <Metric label={tr("قيمة التوفير", "Savings amount")} value={scenario.savings_amount == null ? "-" : formatMoney(scenario.savings_amount)} accent="text-emerald-700 dark:text-emerald-300" />
          <Metric label={tr("نسبة التوفير", "Savings percentage")} value={scenario.savings_pct == null ? "-" : `${fmt(scenario.savings_pct)}%`} accent="text-emerald-700 dark:text-emerald-300" />
          <Metric label={tr("عدد الموردين في الشراء المختلط", "Suppliers in mixed purchase")} value={scenario.mixed_supplier_count} />
        </div>
      </section>
      </details>}

      <Dialog open={offerOpen} onOpenChange={setOfferOpen}>
        <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col gap-0 overflow-hidden p-0" dir={direction} data-testid="offer-modal">
          <DialogHeader className="border-b p-4 pb-3">
            <DialogTitle>{editingKey ? tr("تعديل عرض المورد", "Edit supplier offer") : tr("إضافة عرض مورد", "Add supplier offer")}</DialogTitle>
            <DialogDescription>{tr("اختر من النظام أو أدخل المنتج والمورد يدوياً دون تعديل البيانات الرئيسية.", "Select from the system or enter the product and supplier manually without changing master data.")}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid grid-cols-2 rounded-md bg-muted p-1">
              <Button type="button" size="sm" variant={draft.entry_mode === "system" ? "default" : "ghost"} onClick={() => switchEntryMode("system")} data-testid="entry-mode-system">{tr("إضافة من النظام", "Add from system")}</Button>
              <Button type="button" size="sm" variant={draft.entry_mode === "manual" ? "default" : "ghost"} onClick={() => switchEntryMode("manual")} data-testid="entry-mode-manual">{tr("إضافة يدوياً", "Add manually")}</Button>
            </div>

            {draft.entry_mode === "system" ? <div className="space-y-3" data-testid="system-entry-form">
              <FormField label={tr("المورد *", "Supplier *")}><SearchableSelect value={draft.supplier_id} options={supplierOptions} placeholder={tr("ابحث واختر المورد", "Search and select supplier")} searchPlaceholder={tr("بحث باسم أو كود أو هاتف المورد...", "Search by supplier name, code, or phone...")} selectedTitle testId="offer-system-supplier" onValueChange={chooseSupplier} /></FormField>
              <div className="flex items-center justify-between"><h4 className="text-xs font-bold text-foreground">{tr("تصفية المنتج", "Product filters")}</h4><Button type="button" size="sm" variant="ghost" className="h-7" onClick={clearItemFilters} data-testid="clear-item-filters">{tr("مسح الفلاتر", "Clear filters")}</Button></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <FormField label={tr("التصنيف الرئيسي *", "Main category *")}><SearchableSelect value={draft.main_category} options={categoryChoices} placeholder={tr("اختر التصنيف", "Select category")} testId="offer-main-category" onValueChange={(value) => setDraft((current) => changeMainCategory(current, value))} /></FormField>
                <FormField label={tr("التصنيف الفرعي *", "Subcategory *")}><SearchableSelect value={draft.subcategory} options={subcategoryChoices} placeholder={tr("اختر التصنيف الفرعي", "Select subcategory")} disabled={!draft.main_category} testId="offer-subcategory" onValueChange={(value) => setDraft((current) => changeSubcategory(current, value))} /></FormField>
                <FormField label={tr("العلامة التجارية *", "Brand *")}><SearchableSelect value={draft.brand} options={brandChoices} placeholder={tr("اختر العلامة", "Select brand")} disabled={!draft.subcategory} testId="offer-brand" onValueChange={(value) => setDraft((current) => changeBrand(current, value))} /></FormField>
                <FormField label={tr(`المنتج * — ${matchingItems.length} مطابق`, `Product * — ${matchingItems.length} matches`)}><SearchableSelect value={draft.item_id} options={productOptions} placeholder={tr("ابحث داخل النتائج", "Search results")} searchPlaceholder={tr("بحث في المنتجات المطابقة...", "Search matching products...")} emptyMessage={tr("لا توجد منتجات مطابقة للفلاتر", "No products match the filters")} disabled={!draft.brand} selectedTitle testId="offer-product" onValueChange={chooseItem} /></FormField>
              </div>
              {draft.item_id && <div className="grid grid-cols-2 gap-2 rounded-md border border-blue-500/20 bg-blue-500/10 p-3 text-[11px] md:grid-cols-4" data-testid="selected-item-details">
                <span><b>{tr("الكود:", "Code:")}</b> {draft.item_code || "-"}</span><span><b>{tr("الوحدة:", "Unit:")}</b> {draft.unit || "-"}</span><span><b>{tr("آخر سعر:", "Last price:")}</b> {draft.last_historical_unit_price == null ? "-" : formatMoney(draft.last_historical_unit_price)}</span><span><b>{tr("آخر مورد:", "Last supplier:")}</b> {draft.last_supplier_name || "-"}</span><span><b>{tr("تاريخ آخر شراء:", "Last purchase date:")}</b> {draft.last_purchase_date || "-"}</span><span className="md:col-span-3"><b>{tr("المواصفات:", "Specifications:")}</b> {draft.specifications || "-"}</span>
              </div>}
            </div> : <div className="space-y-3" data-testid="manual-entry-form">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label={tr("اسم المورد *", "Supplier name *")}><Input value={draft.supplier_name} data-testid="manual-supplier-name" onChange={(event) => updateDraft("supplier_name", event.target.value)} /></FormField>
                <FormField label={tr("اسم المنتج *", "Product name *")}><Input value={draft.product_name} data-testid="manual-product-name" onChange={(event) => updateDraft("product_name", event.target.value)} /></FormField>
                <FormField label={tr("العلامة التجارية", "Brand")}><Input value={draft.brand} onChange={(event) => updateDraft("brand", event.target.value)} /></FormField>
                <FormField label={tr("التصنيف الرئيسي", "Main category")}><Input value={draft.main_category} onChange={(event) => updateDraft("main_category", event.target.value)} /></FormField>
                <FormField label={tr("التصنيف الفرعي", "Subcategory")}><Input value={draft.subcategory} onChange={(event) => updateDraft("subcategory", event.target.value)} /></FormField>
                <FormField label={tr("الوحدة", "Unit")}><Input value={draft.unit} onChange={(event) => updateDraft("unit", event.target.value)} /></FormField>
                <FormField label={tr("المواصفات", "Specifications")} className="sm:col-span-2"><Textarea rows={2} value={draft.specifications} onChange={(event) => updateDraft("specifications", event.target.value)} /></FormField>
              </div>
              <div className="flex flex-wrap gap-2 rounded-md border border-violet-500/20 bg-violet-500/10 p-2">
                <span className="w-full text-[11px] text-violet-700 dark:text-violet-300">{tr("لن تُضاف هذه البيانات للبيانات الرئيسية تلقائياً.", "This data will not be added to master data automatically.")}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => requestSaveToMaster("supplier")} data-testid="save-manual-supplier"><UserPlus className="h-3.5 w-3.5" /> {tr("حفظ المورد في الموردين", "Save supplier to suppliers")}</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => requestSaveToMaster("item")} data-testid="save-manual-item"><PackagePlus className="h-3.5 w-3.5" /> {tr("إضافة إلى الأصناف", "Add to Item Master")}</Button>
              </div>
            </div>}

            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <FormField label={tr("الكمية *", "Quantity *")}><Input {...numberInputProps("quantity")} value={draft.quantity} data-testid="offer-quantity" onChange={(event) => updateDraft("quantity", event.target.value)} /></FormField>
              <FormField label={tr("سعر الوحدة", "Unit price")}><Input {...numberInputProps("unit_price")} value={draft.unit_price} data-testid="offer-unit-price" onChange={(event) => updateDraft("unit_price", event.target.value)} /></FormField>
              <FormField label={tr("التسليم بالأيام", "Delivery in days")}><Input {...numberInputProps("delivery_days")} value={draft.delivery_days} onChange={(event) => updateDraft("delivery_days", event.target.value)} /></FormField>
              <FormField label={tr("التوفر", "Availability")}><select className="h-9 w-full rounded-md border bg-background px-2 text-xs" value={draft.availability} onChange={(event) => updateDraft("availability", event.target.value)}><option value="available">{tr("متاح", "Available")}</option><option value="unavailable">{tr("غير متاح", "Unavailable")}</option></select></FormField>
              <FormField label={tr("الوحدة", "Unit")}><Input value={draft.unit} onChange={(event) => updateDraft("unit", event.target.value)} /></FormField>
            </div>
            <details className="rounded-md border">
              <summary className="cursor-pointer p-3 text-xs font-bold">{tr("تفاصيل العرض الاختيارية", "Optional offer details")}</summary>
              <div className="grid grid-cols-2 gap-3 border-t p-3 md:grid-cols-4">
                <FormField label={tr("شروط الدفع", "Payment terms")}><Input value={draft.payment_terms} onChange={(event) => updateDraft("payment_terms", event.target.value)} /></FormField>
                <FormField label={tr("صلاحية السعر", "Price valid until")}><Input type="date" value={draft.price_valid_until} onChange={(event) => updateDraft("price_valid_until", event.target.value)} /></FormField>
                <FormField label={tr("ملاحظات", "Notes")} className="col-span-2"><Textarea rows={1} value={draft.notes} onChange={(event) => updateDraft("notes", event.target.value)} /></FormField>
              </div>
            </details>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-card p-3">
            <Button type="button" variant="outline" onClick={() => setOfferOpen(false)}>{tr("إلغاء", "Cancel")}</Button>
            <Button type="button" onClick={commitDraft} data-testid="offer-modal-save"><Save className="h-4 w-4" /> {editingKey ? tr("حفظ التعديل", "Save changes") : tr("إضافة العرض", "Add offer")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open) setConfirmation(""); }}>
        <DialogContent className="max-w-md" dir={direction} data-testid="save-master-confirmation">
          <DialogHeader><DialogTitle>{tr("تأكيد الحفظ في البيانات الرئيسية", "Confirm saving to master data")}</DialogTitle><DialogDescription>{tr("سيُضاف", "The")} {confirmation === "supplier" ? tr("المورد", "supplier") : tr("المنتج", "product")} {tr("إلى البيانات الرئيسية. لا يحدث هذا تلقائياً.", "will be added to master data. This does not happen automatically.")}</DialogDescription></DialogHeader>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirmation("")}>{tr("إلغاء", "Cancel")}</Button><Button onClick={confirmSaveToMaster} disabled={savingMaster} data-testid="confirm-save-master">{savingMaster ? tr("جارٍ الحفظ", "Saving") : tr("تأكيد الحفظ", "Confirm save")}</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!catalogTarget} onOpenChange={(open) => !open && setCatalogTarget(null)}>
        <DialogContent className="max-w-md" dir={direction} data-testid="add-to-catalog-dialog">
          <DialogHeader>
            <DialogTitle className="text-start">{tr("إضافة إلى الأصناف", "Add to Item Master")}</DialogTitle>
            <DialogDescription className="text-start">{tr("راجع بيانات الصنف اليدوي قبل إضافته إلى دليل الأصناف.", "Review the manual item before adding it to the Item Master.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <FormField label={tr("اسم الصنف", "Item name")}>
              <Input data-testid="catalog-form-name" value={catalogForm.name} onChange={(event) => setCatalogForm({ ...catalogForm, name: event.target.value })} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={tr("الوحدة", "Unit")}>
                <Input data-testid="catalog-form-unit" value={catalogForm.unit} onChange={(event) => setCatalogForm({ ...catalogForm, unit: event.target.value })} />
              </FormField>
              <FormField label={tr("التصنيف الرئيسي", "Main category")}>
                <Input list="catalog-main-category-options" data-testid="catalog-form-main-category" value={catalogForm.main_category} onChange={(event) => setCatalogForm({ ...catalogForm, main_category: event.target.value, subcategory: "" })} />
                <datalist id="catalog-main-category-options">{categoryChoices.filter((option) => option.value).map((option) => <option key={option.value} value={option.label} />)}</datalist>
              </FormField>
              <FormField label={tr("التصنيف الفرعي", "Subcategory")} className="col-span-2">
                <Input list="catalog-subcategory-options" data-testid="catalog-form-subcategory" value={catalogForm.subcategory} onChange={(event) => setCatalogForm({ ...catalogForm, subcategory: event.target.value })} />
                <datalist id="catalog-subcategory-options">{subcategoryOptions(items, catalogForm.main_category).filter((option) => option.value).map((option) => <option key={option.value} value={option.label} />)}</datalist>
              </FormField>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCatalogTarget(null)}>{tr("إلغاء", "Cancel")}</Button>
            <Button onClick={submitAddToCatalog} disabled={savingCatalog} data-testid="catalog-form-submit">{savingCatalog ? tr("جارٍ الإضافة...", "Adding...") : tr("إضافة إلى الأصناف", "Add to Item Master")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={savedOpen} onOpenChange={setSavedOpen}>
        <DialogContent className="max-w-2xl" dir={direction}><DialogHeader><DialogTitle>{tr("المقارنات المحفوظة", "Saved comparisons")}</DialogTitle><DialogDescription>{tr("اختر مقارنة لإعادة فتحها وتعديلها.", "Select a comparison to reopen and edit it.")}</DialogDescription></DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">{saved.map((row) => <div key={row.id} className="flex items-center gap-2 rounded-md border p-2"><button type="button" onClick={() => loadComparison(row.id)} className="flex min-w-0 flex-1 items-center justify-between rounded-md p-1 text-start hover:bg-muted"><div><div className="font-mono text-sm font-bold">{row.comparison_number}</div><div className="text-xs text-muted-foreground">{row.project_name || row.customer_name || tr("بدون مشروع أو عميل", "No project or customer")}</div></div><div className="text-xs text-muted-foreground">{row.comparison_date} — {row.row_count} {tr("عرض", "offers")}</div></button><Button type="button" size="icon" variant="ghost" className="text-destructive" onClick={() => deleteComparison(row.id)} aria-label={tr("حذف المقارنة", "Delete comparison")}><Trash2 className="h-4 w-4" /></Button></div>)}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
