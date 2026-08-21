import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ChevronDown, ChevronLeft, ChevronRight, Copy, Download, FilePlus2,
  FolderOpen, PackagePlus, Pencil, Plus, Printer, Save, Trash2, UserPlus,
  Send, Paperclip, ExternalLink,
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
  calculateComparison, emptyComparisonRow, manualEntryKey,
} from "@/lib/priceComparison";
import ProcurementProgress from "@/components/ProcurementProgress";
import {
  AttachmentBlock, EmptyState, StatusBadge, SupplierCard,
} from "@/components/procurement-ui";
import { useOptionalAuth } from "@/contexts/AuthContext";


const today = () => new Date().toISOString().slice(0, 10);
const money = (value) => `${fmt(value)} ج.م`;
const numberFields = new Set([
  "quantity", "unit_price", "discount_pct", "tax_pct", "shipping_cost",
  "other_cost", "delivery_days", "selected_for_purchase",
]);
const rowPayloadFields = [
  "item_id", "item_code", "product_name", "brand", "main_category",
  "subcategory", "specifications", "supplier_id", "supplier_code",
  "supplier_name", "quantity", "unit", "unit_price", "discount_pct",
  "tax_pct", "shipping_cost", "other_cost", "delivery_days", "payment_terms",
  "availability", "price_valid_until", "notes",
  "selected_for_purchase",
];

const rowItemKey = (row) => row.item_id || row.item_code || row.manual_product_key;
const rowSupplierKey = (row) => (
  row.supplier_id || row.supplier_code || row.manual_supplier_key
);
const isManualRow = (row) => !row.item_id || !row.supplier_id;

const comparisonFingerprint = ({ projectName, customerName, comparisonDate, notes, rows }) => JSON.stringify({
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
});

function Metric({ label, value, accent = "text-slate-900" }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-2.5">
      <div className="text-[11px] text-slate-500">{label}</div>
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
  return <article className="rounded-lg border border-blue-200 bg-white p-3" data-testid="request-attachment">
    {attachment.is_image && objectUrl && <img src={objectUrl} alt={attachment.original_filename} className="mb-3 max-h-64 w-full rounded-md bg-slate-50 object-contain" />}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0"><div className="truncate text-sm font-bold">{attachment.original_filename}</div><div className="mt-1 text-xs text-slate-500">{attachment.item_label || tr("مرفق طلب الشراء", "Purchase request attachment")}</div></div>
      {objectUrl && <Button asChild type="button" size="sm" variant="outline"><a href={objectUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> {tr("فتح / عرض", "Open / view")}</a></Button>}
    </div>
  </article>;
}

function SupplierOfferColumn({
  group, itemOrder, tr, formatMoney, onPrice, onSelectRow, onSelectSupplier,
  onEdit, onDelete, quotation, canUpload, onUpload, onViewAttachment,
  isCheapestComplete,
}) {
  const summary = group.summary || {};
  const selectedCount = group.rows.filter((row) => Number(row.selected_for_purchase || 0) === 1).length;
  return (
    <SupplierCard
      title={group.supplierName || tr("مورد غير محدد", "Unassigned supplier")}
      subtitle={group.supplierCode || tr(`${group.rows.length} بنود مسعرة`, `${group.rows.length} quoted items`)}
      className={isCheapestComplete ? "border-emerald-300 ring-1 ring-emerald-200" : undefined}
      testId="supplier-offer-card"
      badges={<>
        {summary.is_complete ? <StatusBadge tone="success">{tr("عرض كامل", "Complete offer")}</StatusBadge> : <StatusBadge tone="warning">{tr("عرض غير مكتمل", "Incomplete offer")}</StatusBadge>}
        {isCheapestComplete && <StatusBadge tone="success">{tr("الأرخص كاملًا", "Cheapest complete")}</StatusBadge>}
        {!!selectedCount && <StatusBadge tone="primary">{tr(`${selectedCount} مختار`, `${selectedCount} selected`)}</StatusBadge>}
      </>}
      footer={<div className="space-y-3">
        <AttachmentBlock
          title={tr("مرفق عرض المورد", "Supplier quotation attachment")}
          attachments={quotation?.attachments || []}
          canUpload={canUpload && !!quotation}
          onUpload={(files) => onUpload(quotation, files)}
          onView={onViewAttachment}
          helper={quotation ? tr("المرفقات محفوظة على عرض المورد الأصلي.", "Files remain attached to the original supplier quotation.") : tr("يظهر المرفق عند استيراد العرض من RFQ.", "Attachments appear when the offer is imported from an RFQ.")}
        />
        <Button type="button" className="w-full" variant={selectedCount ? "default" : "outline"} disabled={!summary.is_complete} onClick={() => onSelectSupplier(group)} data-testid={`select-supplier-offer-${group.key}`}>
          {selectedCount ? tr("العرض محدد للشراء", "Offer selected") : tr("اختيار عرض المورد", "Select supplier offer")}
        </Button>
      </div>}
    >
      <div className="divide-y divide-slate-100">
        <div className="grid grid-cols-[minmax(0,1.3fr)_58px_88px_88px] gap-2 bg-slate-50 px-3 py-2 text-[10px] font-bold text-slate-500">
          <span>{tr("الصنف", "Item")}</span><span className="text-center">{tr("الكمية", "Qty")}</span><span className="text-center">{tr("سعر الوحدة", "Unit price")}</span><span className="text-center">{tr("الإجمالي", "Total")}</span>
        </div>
        {itemOrder.map((item) => {
          const row = group.rowsByItem.get(item.itemKey);
          if (!row) return <div key={item.itemKey} className="grid min-h-[76px] grid-cols-[minmax(0,1.3fr)_58px_88px_88px] items-center gap-2 bg-slate-50/50 px-3 py-2 text-xs text-slate-400"><span className="truncate">{item.product_name}</span><span className="text-center">{fmt(item.quantity)}</span><span className="text-center">—</span><span className="text-center">{tr("غير مقدم", "Not quoted")}</span></div>;
          const rowTone = row.selected_for_purchase ? "bg-primary/5" : row.is_unavailable ? "bg-red-50/70" : row.is_incomplete ? "bg-amber-50/70" : row.is_lowest_final_total ? "bg-emerald-50/70" : "";
          return <div key={item.itemKey} className={`min-h-[76px] px-3 py-2 ${rowTone}`} data-testid="comparison-row">
            <div className="grid grid-cols-[minmax(0,1.3fr)_58px_88px_88px] items-center gap-2">
              <div className="min-w-0"><div className="truncate text-xs font-semibold text-slate-800" title={row.product_name}>{row.product_name}</div><div className="mt-1 flex flex-wrap gap-1">{row.is_lowest_final_total && <StatusBadge tone="success">{tr("أقل سعر", "Lowest")}</StatusBadge>}{row.is_unavailable && <StatusBadge tone="danger">{tr("غير متاح", "Unavailable")}</StatusBadge>}{row.is_incomplete && <StatusBadge tone="warning">{tr("ناقص", "Incomplete")}</StatusBadge>}</div></div>
              <span className="text-center text-xs tabular-nums">{fmt(row.quantity)}</span>
              <Input type="number" min="0" step="0.01" value={row.unit_price || ""} onChange={(event) => onPrice(row.key, event.target.value)} className="h-8 px-1 text-center text-xs" data-testid={`inline-unit-price-${row.key}`} />
              <span className="text-center text-xs font-bold tabular-nums text-slate-800">{formatMoney(row.final_total)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-slate-500"><span>{row.availability === "available" ? tr("متاح", "Available") : tr("غير متاح", "Unavailable")} · {row.delivery_days || 0} {tr("يوم", "days")}</span><span className="flex gap-1"><button type="button" className="font-semibold text-primary" onClick={() => onSelectRow(row)} disabled={!row.eligible}>{row.selected_for_purchase ? tr("إلغاء الاختيار", "Unselect") : tr("اختيار البند", "Select line")}</button><button type="button" title={tr("تعديل", "Edit")} className="font-semibold text-slate-500" onClick={() => onEdit(row)}>{tr("تعديل", "Edit")}</button><button type="button" title={tr("حذف", "Delete")} className="font-semibold text-red-600" onClick={() => onDelete(row.key)}>{tr("حذف", "Delete")}</button></span></div>
          </div>;
        })}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 p-3 text-xs">
        <span className="text-slate-500">{tr("الإجمالي قبل الإضافات", "Subtotal")}</span><b className="text-end">{formatMoney(summary.items_subtotal)}</b>
        <span className="text-slate-500">{tr("الخصم", "Discount")}</span><b className="text-end">-{formatMoney(summary.total_discounts)}</b>
        <span className="text-slate-500">{tr("الضريبة", "VAT")}</span><b className="text-end">{formatMoney(summary.total_taxes)}</b>
        <span className="text-slate-500">{tr("الشحن وتكاليف أخرى", "Shipping & other")}</span><b className="text-end">{formatMoney(Number(summary.total_shipping || 0) + Number(summary.total_other_costs || 0))}</b>
        <span className="border-t pt-2 font-bold text-slate-800">{tr("الإجمالي النهائي", "Final total")}</span><b className="border-t pt-2 text-end text-sm text-primary">{formatMoney(summary.final_offer_total)}</b>
        <span className="text-slate-500">{tr("مدة التوريد", "Lead time")}</span><b className="text-end">{summary.maximum_delivery_days ?? "-"} {tr("يوم", "days")}</b>
        <span className="text-slate-500">{tr("شروط الدفع", "Payment terms")}</span><b className="truncate text-end" title={group.rows[0]?.payment_terms}>{group.rows[0]?.payment_terms || "-"}</b>
        <span className="text-slate-500">{tr("صلاحية العرض", "Offer validity")}</span><b className="text-end">{group.rows[0]?.price_valid_until || "-"}</b>
      </div>
    </SupplierCard>
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
  const [supplierQuotations, setSupplierQuotations] = useState(
    initialComparison?.supplier_quotations || location.state?.supplierQuotations || [],
  );
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
  const [offerOpen, setOfferOpen] = useState(false);
  const [editingKey, setEditingKey] = useState("");
  const [draft, setDraft] = useState(() => ({ ...emptyComparisonRow(), entry_mode: "system" }));
  const [confirmation, setConfirmation] = useState("");
  const [savingMaster, setSavingMaster] = useState(false);
  const savedFingerprintRef = useRef(comparisonFingerprint({
    projectName: initialComparison?.project_name,
    customerName: initialComparison?.customer_name,
    comparisonDate: initialComparison?.comparison_date || today(),
    notes: initialComparison?.notes,
    rows: initialComparison?.rows || [],
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
    searchText: `${supplier.phone || ""} ${supplier.email || ""}`,
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
    () => calculateComparison(rows, items, suppliers, comparisonDate),
    [rows, items, suppliers, comparisonDate],
  );
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
    filteredRows.forEach((row) => {
      const key = rowSupplierKey(row) || row.supplier_name || `unassigned-${row.key}`;
      if (!groups.has(key)) groups.set(key, {
        key,
        supplierName: row.supplier_name,
        supplierCode: row.supplier_code,
        rows: [],
        rowsByItem: new Map(),
        summary: summaries.get(key),
      });
      groups.get(key).rows.push(row);
      groups.get(key).rowsByItem.set(rowItemKey(row), row);
    });
    return [...groups.values()];
  }, [calculations.supplier_summaries, filteredRows]);
  const supplierPageCount = Math.max(1, Math.ceil(supplierOfferGroups.length / 3));
  const visibleSupplierGroups = supplierOfferGroups.slice(supplierPage * 3, supplierPage * 3 + 3);
  useEffect(() => {
    if (supplierPage >= supplierPageCount) setSupplierPage(supplierPageCount - 1);
  }, [supplierPage, supplierPageCount]);

  const currentFingerprint = useMemo(() => comparisonFingerprint({
    projectName, customerName, comparisonDate, notes, rows,
  }), [projectName, customerName, comparisonDate, notes, rows]);
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
      projectName: "", customerName: "", comparisonDate: today(), notes: "", rows: [],
    });
    setComparisonId("");
    setComparisonNumber("");
    setProjectName("");
    setCustomerName("");
    setSourceRequestId("");
    setSourceRequestNumber("");
    setSourceAttachments([]);
    setSourceRfqId("");
    setSupplierQuotations([]);
    setSupplierPage(0);
    setComparisonDate(today());
    setNotes("");
    setRows([]);
    setSearch("");
    setProductFilter("");
    setSupplierFilter("");
    setCategoryFilter("");
    setSubcategoryFilter("");
    setBrandFilter("");
    setAvailabilityFilter("");
  };
  const sourceRequestItemToRow = (requestItem) => {
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
      supplier_id: "",
      supplier_code: "",
      supplier_name: "",
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
  };

  return row;
  };


  const addSourceRequestItem = (requestItem) => {
    const newRow = sourceRequestItemToRow(requestItem);

  setRows((current) => [...current, newRow]);

  toast.success(
    tr(
      `تمت إضافة ${requestItem.product_name || "الصنف"} للمقارنة`,
      "Item added to comparison"
    )
  );
  };


  const addAllSourceRequestItems = () => {
    const requestItems = sourceRequest?.items || [];

  if (!requestItems.length) {
    toast.error(
      tr(
        "لا توجد أصناف في طلب الشراء",
        "There are no items in the purchase request"
      )
    );
    return;
  }

  const newRows = requestItems.map(sourceRequestItemToRow);

  setRows((current) => [...current, ...newRows]);

  toast.success(
    tr(
      `تمت إضافة ${newRows.length} صنف للمقارنة`,
      `${newRows.length} items added to comparison`
    )
  );
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
      discount_pct: current.discount_pct,
      tax_pct: current.tax_pct,
      shipping_cost: current.shipping_cost,
      other_cost: current.other_cost,
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

  const selectSupplierOffer = (group) => {
    if (!group.summary?.is_complete) {
      toast.error(tr("لا يمكن اختيار عرض غير مكتمل", "An incomplete offer cannot be selected"));
      return;
    }
    const selectedByItem = new Map(group.rows.filter((row) => row.eligible).map((row) => [rowItemKey(row), row.key]));
    setRows((current) => current.map((row) => {
      const selectedKey = selectedByItem.get(rowItemKey(row));
      if (!selectedKey) return row;
      return { ...row, selected_for_purchase: row.key === selectedKey ? 1 : 0 };
    }));
  };

  const quotationForGroup = (group) => supplierQuotations.find((quotation) => (
    (quotation.supplier_id && quotation.supplier_id === group.key)
    || quotation.supplier_name === group.supplierName
  ));

  const viewQuotationAttachment = async (attachment) => {
    try {
      const { data } = await api.get(attachment.download_url, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { toast.error(errMsg(error)); }
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
    } catch (error) { toast.error(errMsg(error)); }
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
    return null;
  };
  const applyDetail = (detail) => {
    savedFingerprintRef.current = comparisonFingerprint({
      projectName: detail.project_name,
      customerName: detail.customer_name,
      comparisonDate: detail.comparison_date,
      notes: detail.notes,
      rows: detail.rows,
    });
    setComparisonId(detail.id);
    setComparisonNumber(detail.comparison_number);
    setProjectName(detail.project_name || "");
    setCustomerName(detail.customer_name || "");
    setSourceRequestId(detail.source_request_id || "");
    setSourceRequestNumber(detail.source_request_number || "");
    setSourceAttachments(detail.source_attachments || []);
    setSourceRfqId(detail.source_rfq_id || "");
    setSupplierQuotations(detail.supplier_quotations || []);
    setComparisonDate(detail.comparison_date);
    setNotes(detail.notes || "");
    setRows(detail.rows.map((row) => ({
      ...row,
      key: row.id || globalThis.crypto?.randomUUID?.(),
      entry_mode: isManualRow(row) ? "manual" : "system",
    })));
  };
  const save = async () => {
    const error = validateComparison();
    if (error) { toast.error(error); return; }
    setSaving(true);
    try {
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

const selectedPurchaseTotal = selectedPurchaseRows.reduce(
  (sum, row) => sum + Number(row.final_total || 0),
  0,
);

const allComparisonItemsCount = new Set(
  calculations.rows.map((row) => rowItemKey(row)).filter(Boolean),
).size;

const unselectedPurchaseItemCount = Math.max(
  allComparisonItemsCount - selectedPurchaseItemCount,
  0,

);
const preparePurchaseOrders = async () => {
if (!selectedPurchaseRows.length) {
toast.error(
  tr(
    "اختر عرضًا واحدًا على الأقل للشراء أولًا",
    "Select at least one offer for purchase first"
  )
);
return;
}
if (!comparisonId) {
toast.error(
  tr(
    "احفظ المقارنة أولًا قبل إنشاء أوامر الشراء",
    "Save the comparison before creating purchase orders"
  )
);
return;
}
if (hasUnsavedChanges) {
toast.error(
  tr(
    "احفظ اختيارات الشراء الحالية قبل إنشاء أوامر الشراء",
    "Save the current purchase selections before creating purchase orders",
  )
);
return;
}

const grouped = {};
 selectedPurchaseRows.forEach((row) => {
    const supplierKey = rowSupplierKey(row);

    if (!grouped[supplierKey]) {
      grouped[supplierKey] = {
        supplier_id: row.supplier_id || "",
        supplier_name: row.supplier_name || "",
        items: [],
        total: 0,
      };
    }

    grouped[supplierKey].items.push({
      item_id: row.item_id || "",
      item_code: row.item_code || "",
      product_name: row.product_name || "",
      brand: row.brand || "",
      specifications: row.specifications || "",
      quantity: Number(row.quantity || 0),
      unit: row.unit || "",
      unit_price: Number(row.unit_price || 0),
      discount_pct: Number(row.discount_pct || 0),
      vat_pct: Number(row.tax_pct || 0),
      shipping_cost: Number(row.shipping_cost || 0),
      other_cost: Number(row.other_cost || 0),
      line_total: Number(row.final_total || 0),
    });

    grouped[supplierKey].total += Number(row.final_total || 0);
  });

const preparedOrders = Object.values(grouped);
try {
const project = projects.find(
  (entry) => entry.name === projectName
);

const customer = customers.find(
  (entry) => entry.name === customerName
);

const response = await api.post(
  "/purchase-orders/from-comparison",
  {
    comparison_id: comparisonId,
    comparison_number: comparisonNumber,

    project_id: project?.id || "",
    project_name: projectName || "",

    customer_id: customer?.id || "",
    customer_name: customerName || "",

    po_date: today(),
    created_by: "",

    orders: preparedOrders,
  }
);

toast.success(
  tr(
    `تم إنشاء ${response.data.count} أمر شراء بنجاح`,
    `${response.data.count} purchase orders created successfully`
  )
);
} catch (error) {
toast.error(errMsg(error));
}
};
  const sendForApproval = async () => {
    if (!comparisonId) return toast.error(tr("احفظ المقارنة أولاً", "Save the comparison first"));
    if (hasUnsavedChanges) return toast.error(tr("احفظ الاختيارات الحالية أولاً", "Save the current selections first"));
    if (!selectedPurchaseRows.length) return toast.error(tr("اختر عرضًا صالحًا واحدًا على الأقل", "Select at least one valid offer"));
    try {
      const { data } = await api.post("/workflow/approvals/from-comparison", {
        comparison_id: comparisonId,
        created_by: "",
        approval_type: "comparison_workflow",
      });
      toast.success(tr(`أُرسلت المقارنة لمهندس المشتريات — ${data.approval.approval_number}`, `Sent to procurement engineer — ${data.approval.approval_number}`));
      navigate("/approvals", { state: { approval_id: data.approval.id } });
    } catch (error) { toast.error(errMsg(error)); }
  };
  return (
    <div className="space-y-4 supplier-comparison-page" data-testid="supplier-price-comparison-page">
      <section className="rounded-lg border border-slate-200 bg-white p-4 print:border-0 print:p-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1 text-[11px] font-semibold text-slate-500">{tr("1 — بيانات المقارنة", "1 — Comparison details")}</div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-slate-900">{tr("مقارنة أسعار الموردين", "Supplier price comparison")}</h2>
              {comparisonNumber && <span className="rounded bg-slate-100 px-2 py-1 font-mono text-xs">{comparisonNumber}</span>}
              {sourceRequestNumber && <span className="rounded bg-blue-50 px-2 py-1 font-mono text-xs text-blue-700" title={tr("طلب الشراء المصدر", "Source purchase request")}>{sourceRequestNumber}</span>}
            </div>
            <p className="mt-1 text-xs text-slate-500">{tr("مقارنة قرار فقط — لا تنشئ عملية شراء", "Decision comparison only — it does not create a purchase")}</p>
          </div>
          <div className="flex flex-wrap gap-2 comparison-actions comparison-print-hidden">
            <Button size="sm" variant="outline" onClick={reset}><FilePlus2 className="h-4 w-4" /> {tr("جديدة", "New")}</Button>
            <Button size="sm" variant="outline" onClick={openSaved}><FolderOpen className="h-4 w-4" /> {tr("فتح", "Open")}</Button>
            <Button size="sm" onClick={save} disabled={saving} data-testid="comparison-save">
              <Save className="h-4 w-4" /> {saving ? tr("جارٍ الحفظ", "Saving") : tr("حفظ المقارنة", "Save comparison")}
            </Button>
            <Button size="sm" variant="outline" onClick={exportExcel}><Download className="h-4 w-4" /> Excel</Button>
            <Button size="sm" variant="outline" onClick={sendForApproval}><Send className="h-4 w-4" /> {tr("إرسال لمهندس المشتريات", "Send to procurement engineer")}</Button>
            <Button size="sm" variant="outline" data-testid="comparison-print" onClick={() => window.print()}><Printer className="h-4 w-4" /> {tr("طباعة", "Print")}</Button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <FormField label={tr("المشروع — اختياري", "Project — optional")}>
            <Input list="comparison-projects" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
            <datalist id="comparison-projects">{projects.map((row) => <option key={row.id} value={row.name} />)}</datalist>
          </FormField>
          <FormField label={tr("العميل — اختياري", "Customer — optional")}>
            <Input list="comparison-customers" value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
            <datalist id="comparison-customers">{customers.map((row) => <option key={row.id} value={row.name} />)}</datalist>
          </FormField>
          <FormField label={tr("تاريخ المقارنة *", "Comparison date *")}>
            <Input type="date" value={comparisonDate} onChange={(event) => setComparisonDate(event.target.value)} />
          </FormField>
          <FormField label={tr("ملاحظات", "Notes")}>
            <Textarea rows={1} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </FormField>
        </div>
      </section>
      <ProcurementProgress currentStage={2} />
      {sourceRequestId && <section className="rounded-lg border-2 border-blue-200 bg-blue-50 p-4" data-testid="source-request-attachments">
        <div className="mb-3 flex items-center gap-2"><Paperclip className="h-5 w-5 text-blue-700" /><div><h3 className="font-bold text-slate-900">{tr("مرفقات طلب الشراء", "Purchase request attachments")}</h3><p className="text-xs text-slate-600">{tr("اعرض المستند أثناء إدخال الأصناف والأسعار يدويًا.", "Keep the document visible while entering items and prices manually.")}</p></div></div>
        {sourceAttachments.length ? <div className="grid gap-3 lg:grid-cols-2">{sourceAttachments.map((attachment) => <RequestAttachmentCard key={attachment.id} attachment={attachment} tr={tr} />)}</div> : <div className="rounded-md border border-dashed border-blue-200 bg-white/70 p-4 text-center text-sm text-slate-500">{tr("لا توجد مرفقات محفوظة لهذا الطلب.", "No saved attachments for this request.")}</div>}
      </section>}
      <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
  <div className="mb-3">
    <h3 className="text-sm font-bold text-slate-900">
      {tr("ملخص التجهيز للشراء", "Purchase preparation summary")}
    </h3>

    <p className="mt-1 text-xs text-slate-600">
      {tr(
        "ملخص الأصناف التي تم اختيار عروضها فعليًا للشراء.",
        "Summary of items with offers actually selected for purchase."
      )}
    </p>
  </div>

  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    <Metric
      label={tr("الأصناف المختارة", "Selected items")}
      value={selectedPurchaseItemCount}
      accent="text-emerald-700"
    />

    <Metric
      label={tr("الموردون المختارون", "Selected suppliers")}
      value={selectedPurchaseSupplierCount}
    />

    <Metric
      label={tr("إجمالي الشراء المتوقع", "Expected purchase total")}
      value={formatMoney(selectedPurchaseTotal)}
      accent="text-emerald-700"
    />

    <Metric
      label={tr("أصناف بدون اختيار", "Items without selection")}
      value={unselectedPurchaseItemCount}
      accent={
        unselectedPurchaseItemCount > 0
          ? "text-amber-700"
          : "text-emerald-700"
      }
    />
  </div>
    <div className="mt-4 flex justify-end">
    <Button
      type="button"
      onClick={preparePurchaseOrders}
      disabled={!selectedPurchaseRows.length}
    >
      {tr("تجهيز أوامر الشراء", "Prepare purchase orders")}
    </Button>
  </div>
</section>
{sourceRequest && (
  <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-bold text-slate-900">
          أصناف طلب الشراء
        </h3>

        <div className="mt-1 text-xs text-slate-600">
          {sourceRequest.request_number} — {sourceRequest.project_name || "-"}
        </div>

        <div className="mt-1 text-xs text-slate-500">
          مقدم الطلب: {sourceRequest.requester_name || "-"}
        </div>
      </div>

      <div className="flex items-center gap-2">
  <div className="rounded-md bg-white px-3 py-2 text-xs font-bold text-blue-700">
    {sourceRequest.items?.length || 0} صنف
  </div>

  <Button
    type="button"
    size="sm"
    onClick={addAllSourceRequestItems}
    data-testid="add-all-request-items"
  >
    <Plus className="h-4 w-4" />
    {tr("إضافة كل الأصناف", "Add all items")}
  </Button>
</div>
    </div>

    <div className="mt-4 space-y-2">
      {(sourceRequest.items || []).map((item) => {
        const statusLabel = {
          approved: "معتمد",
          rejected: "مرفوض",
          need_clarification: "يحتاج استكمال",
          pending: "قيد المراجعة",
          hold: "معلّق",
        }[item.review_status] || item.review_status || "قيد المراجعة";

        const statusClass = {
          approved: "border-emerald-200 bg-emerald-50",
          rejected: "border-red-200 bg-red-50",
          need_clarification: "border-blue-200 bg-blue-50",
          pending: "border-slate-200 bg-slate-50",
          hold: "border-amber-200 bg-amber-50",
        }[item.review_status] || "border-slate-200 bg-white";
        return (
          <div
            key={item.id}
            className={`rounded-md border p-3 ${statusClass}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold text-slate-800">
                  {item.position}. {item.product_name}
                </div>

                <div className="mt-1 text-xs text-slate-500">
                  {item.quantity} {item.unit}
                  {item.preferred_brand ? ` — ${item.preferred_brand}` : ""}
                </div>

                {item.specifications && (
                  <div className="mt-1 text-xs text-slate-600">
                    {item.specifications}
                  </div>
                )}

                {item.review_reason && (
                  <div className="mt-1 text-xs text-slate-500">
                    {item.review_reason}
                  </div>
                )}
              </div>

            <div className="flex items-center gap-2">
            <div className="rounded-md bg-white px-2 py-1 text-xs font-bold">
              {statusLabel}
            </div>

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => addSourceRequestItem(item)}
              data-testid={`add-request-item-${item.id}`}
            >
              <Plus className="h-3.5 w-3.5" />
              {tr("إضافة للمقارنة", "Add to comparison")}
            </Button>
          </div>
            </div>
          </div>
        );
      })}
    </div>
  </section>
)}
      <section className="rounded-lg border border-slate-200 bg-white p-4 comparison-print-hidden" data-testid="add-offer-section">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="text-sm font-bold">{tr("2 — إضافة عرض مورد", "2 — Add supplier offer")}</h3><p className="text-xs text-slate-500">{tr("أدخل عرضاً واحداً في نافذة مركزة وسريعة.", "Enter one offer in a focused form.")}</p></div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => openNewOffer("system")} data-testid="comparison-add-offer"><Plus className="h-4 w-4" /> {tr("إضافة عرض", "Add offer")}</Button>
            <Button size="sm" variant="outline" onClick={() => openNewOffer("manual")} data-testid="comparison-add-manual-product"><PackagePlus className="h-4 w-4" /> {tr("إضافة منتج يدوي", "Add manual product")}</Button>
            <Button size="sm" variant="outline" onClick={() => openNewOffer("manual")} data-testid="comparison-add-manual-supplier"><UserPlus className="h-4 w-4" /> {tr("إضافة مورد يدوي", "Add manual supplier")}</Button>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3" data-testid="added-offers-section">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold">{tr("3 — العروض المضافة", "3 — Added offers")} <span className="font-normal text-slate-500">({rows.length})</span></h3>
          <div className="flex flex-1 flex-wrap justify-end gap-2 comparison-print-hidden">
            <Input className="h-8 max-w-64" placeholder={tr("بحث بالمنتج أو المورد...", "Search by product or supplier...")} value={search} onChange={(event) => setSearch(event.target.value)} />
            <select className="h-8 max-w-44 rounded-md border border-slate-200 bg-white px-2 text-xs" value={productFilter} onChange={(event) => setProductFilter(event.target.value)}>
              <option value="">{tr("كل المنتجات", "All products")}</option>{productFilterOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select className="h-8 max-w-44 rounded-md border border-slate-200 bg-white px-2 text-xs" value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
              <option value="">{tr("كل الموردين", "All suppliers")}</option>{supplierFilterOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select data-testid="offers-category-filter" className="h-8 max-w-40 rounded-md border border-slate-200 bg-white px-2 text-xs" value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setSubcategoryFilter(""); setBrandFilter(""); }}>
              <option value="">{tr("كل التصنيفات الرئيسية", "All main categories")}</option>{offerClassificationOptions.categories.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <select data-testid="offers-subcategory-filter" className="h-8 max-w-40 rounded-md border border-slate-200 bg-white px-2 text-xs" value={subcategoryFilter} disabled={!categoryFilter} onChange={(event) => { setSubcategoryFilter(event.target.value); setBrandFilter(""); }}>
              <option value="">{tr("كل التصنيفات الفرعية", "All subcategories")}</option>{offerClassificationOptions.subcategories.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <select data-testid="offers-brand-filter" className="h-8 max-w-40 rounded-md border border-slate-200 bg-white px-2 text-xs" value={brandFilter} disabled={!subcategoryFilter} onChange={(event) => setBrandFilter(event.target.value)}>
              <option value="">{tr("كل العلامات", "All brands")}</option>{offerClassificationOptions.brands.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <select className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs" value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value)}>
              <option value="">{tr("كل حالات التوفر", "All availability states")}</option><option value="available">{tr("متاح", "Available")}</option><option value="unavailable">{tr("غير متاح", "Unavailable")}</option>
            </select>
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => { setSearch(""); setProductFilter(""); setSupplierFilter(""); setCategoryFilter(""); setSubcategoryFilter(""); setBrandFilter(""); setAvailabilityFilter(""); }}>{tr("مسح", "Clear")}</Button>
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setShowDetailedTable((value) => !value)}>{showDetailedTable ? tr("إخفاء الجدول", "Hide table") : tr("جدول تفصيلي", "Detailed table")}</Button>
          </div>
        </div>
        <div data-testid="vertical-offer-cards">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3">
            <div><div className="text-xs font-bold text-slate-700">{tr("مقارنة الموردين", "Supplier comparison")}</div><div className="mt-0.5 text-[11px] text-slate-500">{tr("ثلاثة عروض في كل صفحة مع محاذاة الأصناف رأسيًا.", "Three offers per page with vertically aligned items.")}</div></div>
            <div className="flex items-center gap-2">
              {calculations.scenario_summary.cheapest_complete_supplier && <Button type="button" size="sm" className="bg-emerald-700 hover:bg-emerald-800" onClick={() => { const cheapest = supplierOfferGroups.find((group) => group.key === (calculations.scenario_summary.cheapest_complete_supplier.supplier_id || calculations.scenario_summary.cheapest_complete_supplier.supplier_code || calculations.scenario_summary.cheapest_complete_supplier.supplier_name)); if (cheapest) selectSupplierOffer(cheapest); }} data-testid="select-cheapest-complete-offer">{tr("اختيار أرخص عرض كامل", "Select cheapest complete offer")}</Button>}
              {supplierOfferGroups.length > 3 && <div className="flex items-center gap-1 rounded-md border bg-white p-1"><Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={supplierPage === 0} onClick={() => setSupplierPage((page) => page - 1)} aria-label={tr("الموردون السابقون", "Previous suppliers")}><ChevronRight className="h-4 w-4" /></Button><span className="min-w-16 text-center text-xs text-slate-500" dir="ltr">{supplierPage + 1} / {supplierPageCount}</span><Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={supplierPage + 1 >= supplierPageCount} onClick={() => setSupplierPage((page) => page + 1)} aria-label={tr("الموردون التاليون", "Next suppliers")}><ChevronLeft className="h-4 w-4" /></Button></div>}
            </div>
          </div>
          {visibleSupplierGroups.length ? <div className="grid items-stretch gap-3 xl:grid-cols-3">{visibleSupplierGroups.map((group) => <SupplierOfferColumn key={group.key} group={group} itemOrder={itemOrder} tr={tr} formatMoney={formatMoney} onPrice={(keyValue, value) => updateRowField(keyValue, "unit_price", value)} onSelectRow={selectForPurchase} onSelectSupplier={selectSupplierOffer} onEdit={editRow} onDelete={deleteRow} quotation={quotationForGroup(group)} canUpload={canUploadQuotation} onUpload={uploadQuotationAttachments} onViewAttachment={viewQuotationAttachment} isCheapestComplete={group.key === (calculations.scenario_summary.cheapest_complete_supplier?.supplier_id || calculations.scenario_summary.cheapest_complete_supplier?.supplier_code || calculations.scenario_summary.cheapest_complete_supplier?.supplier_name)} />)}</div> : <EmptyState title={tr("لا توجد عروض موردين", "No supplier offers")} description={tr("أضف عرضًا أو استورد عروض RFQ لبدء المقارنة.", "Add an offer or import RFQ quotations to start comparing.")} />}
        </div>
        {showDetailedTable && <div className="mt-4 overflow-hidden rounded-md border border-slate-200" data-testid="detailed-offers-table">
          <table className="w-full table-fixed text-xs">
            <thead className="bg-slate-50 text-slate-600"><tr>
              <th className="w-[18%] p-2 text-start">{tr("المنتج", "Product")}</th><th className="w-[16%] p-2 text-start">{tr("المورد", "Supplier")}</th>
              <th className="w-[8%] p-2">{tr("الكمية", "Quantity")}</th><th className="w-[11%] p-2">{tr("سعر الوحدة", "Unit price")}</th>
              <th className="w-[13%] p-2">{tr("الإجمالي النهائي", "Final total")}</th><th className="w-[9%] p-2">{tr("التسليم", "Delivery")}</th>
              <th className="w-[9%] p-2">{tr("التوفر", "Availability")}</th><th className="w-[15%] p-2 comparison-print-hidden">{tr("الإجراءات", "Actions")}</th>
            </tr></thead>
            <tbody>{filteredRows.map((row) => {
              const statusClass = row.selected_for_purchase
              ? "bg-emerald-100 ring-1 ring-inset ring-emerald-300"
              : row.is_incomplete
                ? "bg-amber-50"
                : row.is_unavailable
                ? "bg-red-50"
                : row.is_expired || row.is_missing_price
                  ? "bg-orange-50"
                  : row.is_lowest_final_total
                    ? "bg-emerald-50"
                    : row.is_fastest_delivery
                      ? "bg-blue-50"
                      : "";
                       return [
                <tr key={row.key} className={`border-t ${statusClass}`} data-testid="comparison-row">
                  <td className="p-2"><div className="truncate font-medium" title={row.product_name}>{row.product_name}</div><div className="truncate text-[10px] text-slate-500" title={row.brand}>{row.brand || tr("بدون علامة", "No brand")}</div></td>
                  <td className="p-2">
                  <select
                    value={row.supplier_id || ""}
                    onChange={(event) =>
                      updateRowSupplier(row.key, event.target.value)
                    }
                    data-testid={`inline-supplier-${row.key}`}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
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
                  <td className={`p-2 text-center ${row.is_fastest_delivery ? "text-blue-700" : ""}`}>{row.delivery_days} {tr("يوم", "days")}</td>
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
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" title={tr("حذف", "Delete")} data-testid={`delete-offer-${row.key}`} onClick={() => deleteRow(row.key)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div></td>
                </tr>,
                expandedRows.has(row.key) && <tr key={`details-${row.key}`} className="border-t bg-slate-50"><td colSpan={8} className="p-3">
                  <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
                    <span><b>{tr("الكود:", "Code:")}</b> {row.item_code || tr("يدوي", "Manual")}</span><span><b>{tr("الوحدة:", "Unit:")}</b> {row.unit || "-"}</span>
                    <span><b>{tr("التصنيف:", "Category:")}</b> {row.main_category || "-"} / {row.subcategory || "-"}</span><span title={row.specifications}><b>{tr("المواصفات:", "Specifications:")}</b> {row.specifications || "-"}</span>
                    <span><b>{tr("الخصم:", "Discount:")}</b> {fmt(row.discount_pct)}%</span><span><b>{tr("الضريبة:", "VAT:")}</b> {fmt(row.tax_pct)}%</span>
                    <span><b>{tr("الشحن:", "Shipping:")}</b> {formatMoney(row.shipping_cost)}</span><span><b>{tr("تكلفة أخرى:", "Other cost:")}</b> {formatMoney(row.other_cost)}</span>
                    <span><b>{tr("بعد الخصم:", "After discount:")}</b> {formatMoney(row.amount_after_discount)}</span><span><b>{tr("فرق أقل إجمالي:", "Difference from lowest:")}</b> {row.difference_from_lowest == null ? "-" : `${formatMoney(row.difference_from_lowest)} (${fmt(row.difference_pct_from_lowest)}%)`}</span>
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
            {!filteredRows.length && <tr><td colSpan={8} className="p-8 text-center text-slate-400">{tr("لا توجد عروض مضافة أو مطابقة", "No offers have been added or match the filters")}</td></tr>}</tbody>
          </table>
        </div>}
      </section>

      <details className="comparison-summary rounded-lg border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-bold text-slate-700">{tr("التحليل التفصيلي والتوفير", "Detailed analysis and savings")}</summary>
      <section className="mt-4 space-y-3" data-testid="comparison-results-section">
        <h3 className="text-sm font-bold text-slate-800">{tr("4 — مقارنة المنتجات", "4 — Product comparison")}</h3>
        <div className="comparison-matrix overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[940px] text-xs"><thead className="bg-slate-50"><tr>
            <th className="p-2 text-start">{tr("المنتج", "Product")}</th><th className="p-2">{tr("أقل سعر وحدة", "Lowest unit price")}</th><th className="p-2">{tr("أقل إجمالي نهائي", "Lowest final total")}</th><th className="p-2">{tr("أسرع تسليم", "Fastest delivery")}</th><th className="p-2">{tr("آخر سعر شراء", "Last purchase price")}</th><th className="p-2">{tr("الفرق التاريخي", "Historical difference")}</th><th className="p-2">{tr("العروض المتاحة", "Available offers")}</th>
          </tr></thead><tbody>{calculations.product_summaries.map((row) => <tr key={row.item_id || row.item_code || `${row.product_name}-${row.brand}`} className="border-t">
            <td className="max-w-48 truncate p-2 font-medium" title={row.product_name}>{row.product_name}</td>
            <td className="p-2 text-center">{row.lowest_unit_price == null ? "-" : `${formatMoney(row.lowest_unit_price)} — ${row.lowest_unit_price_supplier}`}</td>
            <td className="p-2 text-center text-emerald-700">{row.lowest_final_total == null ? "-" : `${formatMoney(row.lowest_final_total)} — ${row.lowest_final_total_supplier}`}</td>
            <td className="p-2 text-center text-blue-700">{row.fastest_delivery_days == null ? "-" : `${row.fastest_delivery_days} ${tr("يوم", "days")} — ${row.fastest_delivery_supplier}`}</td>
            <td className="p-2 text-center">{row.last_historical_unit_price == null ? "-" : formatMoney(row.last_historical_unit_price)}</td>
            <td className="p-2 text-center">{row.difference_from_last_price == null ? "-" : `${formatMoney(row.difference_from_last_price)} (${fmt(row.difference_pct_from_last_price)}%)`}</td>
            <td className="p-2 text-center">{row.available_offer_count}</td>
          </tr>)}{!calculations.product_summaries.length && <tr><td colSpan={7} className="p-8 text-center text-slate-400">{tr("أضف عروضاً لعرض مقارنة المنتجات", "Add offers to view the product comparison")}</td></tr>}</tbody></table>
        </div>
      </section>

      <section className="space-y-3 comparison-summary" data-testid="supplier-summary-section">
        <h3 className="text-sm font-bold text-slate-800">{tr("5 — ملخص الموردين", "5 — Supplier summary")}</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Metric label={tr("أرخص عرض كامل", "Cheapest complete offer")} value={scenario.cheapest_complete_supplier?.supplier_name} accent="text-emerald-700" />
          <Metric label={tr("أسرع عرض كامل", "Fastest complete offer")} value={scenario.fastest_complete_supplier?.supplier_name} accent="text-blue-700" />
          <Metric label={tr("أعلى توفر", "Highest availability")} value={scenario.highest_availability_supplier?.supplier_name} />
        </div>
        <div className="comparison-matrix overflow-x-auto rounded-lg border border-slate-200 bg-white"><table className="min-w-[1220px] w-full text-xs"><thead className="bg-slate-50"><tr>
          <th className="p-2 text-start">{tr("المورد", "Supplier")}</th><th className="p-2">{tr("المنتجات", "Products")}</th><th className="p-2">{tr("المتاحة", "Available")}</th><th className="p-2">{tr("غير متاح", "Unavailable")}</th><th className="p-2">{tr("البنود", "Items")}</th><th className="p-2">{tr("الخصومات", "Discounts")}</th><th className="p-2">{tr("الضرائب", "Taxes")}</th><th className="p-2">{tr("الشحن", "Shipping")}</th><th className="p-2">{tr("أخرى", "Other")}</th><th className="p-2">{tr("الإجمالي", "Total")}</th><th className="p-2">{tr("التوفر", "Availability")}</th><th className="p-2">{tr("أقصى تسليم", "Maximum delivery")}</th><th className="p-2">{tr("فرق الأرخص", "Difference from lowest")}</th>
        </tr></thead><tbody>{calculations.supplier_summaries.map((row) => <tr key={row.supplier_id || row.supplier_code || row.supplier_name} className="border-t">
          <td className="max-w-48 truncate p-2 font-medium" title={row.supplier_name}>{row.supplier_name}</td><td className="p-2 text-center">{row.products_quoted}</td><td className="p-2 text-center">{row.available_products}</td><td className="p-2 text-center">{row.unavailable_products}</td><td className="p-2 text-center">{formatMoney(row.items_subtotal)}</td><td className="p-2 text-center">{formatMoney(row.total_discounts)}</td><td className="p-2 text-center">{formatMoney(row.total_taxes)}</td><td className="p-2 text-center">{formatMoney(row.total_shipping)}</td><td className="p-2 text-center">{formatMoney(row.total_other_costs)}</td><td className="p-2 text-center font-bold">{formatMoney(row.final_offer_total)}</td><td className="p-2 text-center">{fmt(row.availability_pct)}%</td><td className="p-2 text-center">{row.maximum_delivery_days ?? "-"}</td><td className="p-2 text-center">{row.difference_from_lowest_complete == null ? "-" : `${formatMoney(row.difference_from_lowest_complete)} (${fmt(row.difference_pct_from_lowest_complete)}%)`}</td>
        </tr>)}{!calculations.supplier_summaries.length && <tr><td colSpan={13} className="p-8 text-center text-slate-400">{tr("أضف عروضاً لعرض إجماليات الموردين", "Add offers to view supplier totals")}</td></tr>}</tbody></table></div>
      </section>

      <section className="space-y-3 comparison-summary" data-testid="mixed-savings-section">
        <h3 className="text-sm font-bold text-slate-800">{tr("6 — ملخص الشراء المختلط والتوفير", "6 — Mixed purchase and savings summary")}</h3>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <Metric label={tr("إجمالي الشراء المختلط", "Mixed purchase total")} value={formatMoney(scenario.mixed_supplier_total)} />
          <Metric label={tr("أرخص عرض كامل", "Cheapest complete offer")} value={scenario.single_supplier_total == null ? "-" : formatMoney(scenario.single_supplier_total)} accent="text-emerald-700" />
          <Metric label={tr("قيمة التوفير", "Savings amount")} value={scenario.savings_amount == null ? "-" : formatMoney(scenario.savings_amount)} accent="text-emerald-700" />
          <Metric label={tr("نسبة التوفير", "Savings percentage")} value={scenario.savings_pct == null ? "-" : `${fmt(scenario.savings_pct)}%`} accent="text-emerald-700" />
          <Metric label={tr("عدد الموردين في الشراء المختلط", "Suppliers in mixed purchase")} value={scenario.mixed_supplier_count} />
        </div>
      </section>
      </details>

      <Dialog open={offerOpen} onOpenChange={setOfferOpen}>
        <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col gap-0 overflow-hidden p-0" dir={direction} data-testid="offer-modal">
          <DialogHeader className="border-b p-4 pb-3">
            <DialogTitle>{editingKey ? tr("تعديل عرض المورد", "Edit supplier offer") : tr("إضافة عرض مورد", "Add supplier offer")}</DialogTitle>
            <DialogDescription>{tr("اختر من النظام أو أدخل المنتج والمورد يدوياً دون تعديل البيانات الرئيسية.", "Select from the system or enter the product and supplier manually without changing master data.")}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid grid-cols-2 rounded-md bg-slate-100 p-1">
              <Button type="button" size="sm" variant={draft.entry_mode === "system" ? "default" : "ghost"} onClick={() => switchEntryMode("system")} data-testid="entry-mode-system">{tr("إضافة من النظام", "Add from system")}</Button>
              <Button type="button" size="sm" variant={draft.entry_mode === "manual" ? "default" : "ghost"} onClick={() => switchEntryMode("manual")} data-testid="entry-mode-manual">{tr("إضافة يدوياً", "Add manually")}</Button>
            </div>

            {draft.entry_mode === "system" ? <div className="space-y-3" data-testid="system-entry-form">
              <FormField label={tr("المورد *", "Supplier *")}><SearchableSelect value={draft.supplier_id} options={supplierOptions} placeholder={tr("ابحث واختر المورد", "Search and select supplier")} searchPlaceholder={tr("بحث باسم أو كود أو هاتف المورد...", "Search by supplier name, code, or phone...")} selectedTitle testId="offer-system-supplier" onValueChange={chooseSupplier} /></FormField>
              <div className="flex items-center justify-between"><h4 className="text-xs font-bold text-slate-700">{tr("تصفية المنتج", "Product filters")}</h4><Button type="button" size="sm" variant="ghost" className="h-7" onClick={clearItemFilters} data-testid="clear-item-filters">{tr("مسح الفلاتر", "Clear filters")}</Button></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <FormField label={tr("التصنيف الرئيسي *", "Main category *")}><SearchableSelect value={draft.main_category} options={categoryChoices} placeholder={tr("اختر التصنيف", "Select category")} testId="offer-main-category" onValueChange={(value) => setDraft((current) => changeMainCategory(current, value))} /></FormField>
                <FormField label={tr("التصنيف الفرعي *", "Subcategory *")}><SearchableSelect value={draft.subcategory} options={subcategoryChoices} placeholder={tr("اختر التصنيف الفرعي", "Select subcategory")} disabled={!draft.main_category} testId="offer-subcategory" onValueChange={(value) => setDraft((current) => changeSubcategory(current, value))} /></FormField>
                <FormField label={tr("العلامة التجارية *", "Brand *")}><SearchableSelect value={draft.brand} options={brandChoices} placeholder={tr("اختر العلامة", "Select brand")} disabled={!draft.subcategory} testId="offer-brand" onValueChange={(value) => setDraft((current) => changeBrand(current, value))} /></FormField>
                <FormField label={tr(`المنتج * — ${matchingItems.length} مطابق`, `Product * — ${matchingItems.length} matches`)}><SearchableSelect value={draft.item_id} options={productOptions} placeholder={tr("ابحث داخل النتائج", "Search results")} searchPlaceholder={tr("بحث في المنتجات المطابقة...", "Search matching products...")} emptyMessage={tr("لا توجد منتجات مطابقة للفلاتر", "No products match the filters")} disabled={!draft.brand} selectedTitle testId="offer-product" onValueChange={chooseItem} /></FormField>
              </div>
              {draft.item_id && <div className="grid grid-cols-2 gap-2 rounded-md border border-blue-100 bg-blue-50 p-3 text-[11px] md:grid-cols-4" data-testid="selected-item-details">
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
              <div className="flex flex-wrap gap-2 rounded-md border border-violet-100 bg-violet-50 p-2">
                <span className="w-full text-[11px] text-violet-700">{tr("لن تُضاف هذه البيانات للبيانات الرئيسية تلقائياً.", "This data will not be added to master data automatically.")}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => requestSaveToMaster("supplier")} data-testid="save-manual-supplier"><UserPlus className="h-3.5 w-3.5" /> {tr("حفظ المورد في الموردين", "Save supplier to suppliers")}</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => requestSaveToMaster("item")} data-testid="save-manual-item"><PackagePlus className="h-3.5 w-3.5" /> {tr("إضافة إلى الأصناف", "Add to Item Master")}</Button>
              </div>
            </div>}

            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <FormField label={tr("الكمية *", "Quantity *")}><Input {...numberInputProps("quantity")} value={draft.quantity} data-testid="offer-quantity" onChange={(event) => updateDraft("quantity", event.target.value)} /></FormField>
              <FormField label={tr("سعر الوحدة", "Unit price")}><Input {...numberInputProps("unit_price")} value={draft.unit_price} data-testid="offer-unit-price" onChange={(event) => updateDraft("unit_price", event.target.value)} /></FormField>
              <FormField label={tr("التسليم بالأيام", "Delivery in days")}><Input {...numberInputProps("delivery_days")} value={draft.delivery_days} onChange={(event) => updateDraft("delivery_days", event.target.value)} /></FormField>
              <FormField label={tr("التوفر", "Availability")}><select className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs" value={draft.availability} onChange={(event) => updateDraft("availability", event.target.value)}><option value="available">{tr("متاح", "Available")}</option><option value="unavailable">{tr("غير متاح", "Unavailable")}</option></select></FormField>
              <FormField label={tr("الوحدة", "Unit")}><Input value={draft.unit} onChange={(event) => updateDraft("unit", event.target.value)} /></FormField>
            </div>
            <details className="rounded-md border border-slate-200">
              <summary className="cursor-pointer p-3 text-xs font-bold">{tr("تفاصيل العرض الاختيارية", "Optional offer details")}</summary>
              <div className="grid grid-cols-2 gap-3 border-t p-3 md:grid-cols-4">
                {[['discount_pct', tr('الخصم %', 'Discount %')], ['tax_pct', tr('الضريبة %', 'VAT %')], ['shipping_cost', tr('الشحن', 'Shipping')], ['other_cost', tr('تكلفة أخرى', 'Other cost')]].map(([field, label]) => <FormField key={field} label={label}><Input {...numberInputProps(field)} value={draft[field]} onChange={(event) => updateDraft(field, event.target.value)} /></FormField>)}
                <FormField label={tr("شروط الدفع", "Payment terms")}><Input value={draft.payment_terms} onChange={(event) => updateDraft("payment_terms", event.target.value)} /></FormField>
                <FormField label={tr("صلاحية السعر", "Price valid until")}><Input type="date" value={draft.price_valid_until} onChange={(event) => updateDraft("price_valid_until", event.target.value)} /></FormField>
                <FormField label={tr("ملاحظات", "Notes")} className="col-span-2"><Textarea rows={1} value={draft.notes} onChange={(event) => updateDraft("notes", event.target.value)} /></FormField>
              </div>
            </details>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-white p-3">
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

      <Dialog open={savedOpen} onOpenChange={setSavedOpen}>
        <DialogContent className="max-w-2xl" dir={direction}><DialogHeader><DialogTitle>{tr("المقارنات المحفوظة", "Saved comparisons")}</DialogTitle><DialogDescription>{tr("اختر مقارنة لإعادة فتحها وتعديلها.", "Select a comparison to reopen and edit it.")}</DialogDescription></DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">{saved.map((row) => <button type="button" key={row.id} onClick={() => loadComparison(row.id)} className="flex w-full items-center justify-between rounded-md border p-3 text-start hover:bg-slate-50"><div><div className="font-mono text-sm font-bold">{row.comparison_number}</div><div className="text-xs text-slate-500">{row.project_name || row.customer_name || tr("بدون مشروع أو عميل", "No project or customer")}</div></div><div className="text-xs text-slate-500">{row.comparison_date} — {row.row_count} {tr("عرض", "offers")}</div></button>)}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
