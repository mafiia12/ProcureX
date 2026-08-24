import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Save } from "lucide-react";
import api, { fmtEGP, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SearchableSelect from "@/components/SearchableSelect";
import useUnsavedChanges from "@/hooks/useUnsavedChanges";
import { calculatePurchaseLine, calculatePurchaseTotals } from "@/lib/purchaseMath";
import { usePreferences } from "@/contexts/PreferencesContext";
import {
  brandOptions, changeBrand, changeMainCategory, changeSubcategory, filterItems,
  itemProductName, mainCategoryOptions, selectItem, subcategoryOptions,
} from "@/lib/itemSelection";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const emptyRow = () => ({
  main_category: "", subcategory: "", brand: "", item_id: "",
  product_name: "", item_code: "", specifications: "", unit: "",
  quantity: "", unit_price: "", discount_pct: "", vat_pct: "",
});

const today = () => new Date().toISOString().slice(0, 10);

const initHeader = () => ({
  purchase_date: today(), invoice_number: "", invoice_date: today(), po_number: "",
  supplier_id: "", project_id: "", customer_id: "", created_by: "",
  payment_method: "", notes: "", shipping_cost: "", other_costs: "",
});

const Info = ({ label, value }) => (
  <div className="text-xs">
    <span className="text-slate-400">{label}: </span>
    <span className="text-slate-700 font-medium">{value || "-"}</span>
  </div>
);

const Section = ({ title, children, compact = false }) => (
  <div className={`bg-white border border-slate-200 rounded-lg ${compact ? "p-2.5" : "p-4"}`}>
    <h3 className={`text-sm font-bold text-primary ${compact ? "mb-2" : "mb-3"}`}>{title}</h3>
    {children}
  </div>
);

export default function Purchases() {
  const { language, direction } = usePreferences();
  const tr = (arabic, english) => language === "en" ? english : arabic;
  const [suppliers, setSuppliers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [items, setItems] = useState([]);
  const [settings, setSettings] = useState({});
  const [header, setHeader] = useState(initHeader());
  const [rows, setRows] = useState([emptyRow()]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    Promise.all([
      api.get("/suppliers"), api.get("/projects"), api.get("/customers"),
      api.get("/items"), api.get("/settings"),
    ]).then(([s, p, c, i, st]) => {
      setSuppliers(s.data); setProjects(p.data); setCustomers(c.data); setItems(i.data);
      setSettings(Object.fromEntries(st.data.map((x) => [x.key, x.values])));
    });
  }, []);

  const supplier = suppliers.find((s) => s.id === header.supplier_id);
  const project = projects.find((p) => p.id === header.project_id);
  const customer = customers.find((c) => c.id === header.customer_id);

  const setH = (k, v) => setHeader((h) => ({ ...h, [k]: v }));
  const setRow = (idx, k, v) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, [k]: v } : r)));
  const transformRow = (idx, transform) => setRows((rs) => (
    rs.map((row, i) => (i === idx ? transform(row) : row))
  ));
  const categoryOptions = useMemo(() => mainCategoryOptions(items), [items]);

  const lineTotal = (row) => calculatePurchaseLine(row).total;

  const totals = useMemo(() => {
    const valid = rows.filter((r) => r.item_id);
    return calculatePurchaseTotals(valid, header.shipping_cost, header.other_costs);
  }, [rows, header.shipping_cost, header.other_costs]);

  const isDirty = useMemo(() => (
    header.purchase_date !== today()
    || header.invoice_date !== today()
    || Object.entries(header).some(([key, value]) => (
      !["purchase_date", "invoice_date"].includes(key) && String(value || "").trim()
    ))
    || rows.some((row) => Object.values(row).some((value) => String(value || "").trim()))
  ), [header, rows]);
  useUnsavedChanges(
    isDirty && !saving,
    tr("لديك تغييرات غير محفوظة. هل تريد مغادرة الصفحة؟", "You have unsaved changes. Leave this page?"),
  );

  const validate = () => {
    if (!header.purchase_date) return tr("من فضلك أدخل تاريخ شراء صحيح", "Enter a valid purchase date");
    if (!header.invoice_number.trim()) return tr("من فضلك أدخل رقم الفاتورة", "Enter the invoice number");
    if (!header.supplier_id) return tr("من فضلك اختر المورد", "Select a supplier");
    if (!header.project_id) return tr("من فضلك اختر المشروع", "Select a project");
    if (!header.customer_id) return tr("من فضلك اختر العميل", "Select a customer");
    const valid = rows.filter((r) => r.item_id);
    if (valid.length === 0) return tr("من فضلك أضف صنفاً واحداً على الأقل", "Add at least one item");
    for (const r of valid) {
      const item = items.find((i) => i.id === r.item_id);
      if (!(parseFloat(r.quantity) > 0)) return `${tr("الكمية غير صحيحة للمنتج", "Invalid quantity for product")}: ${itemProductName(item)}`;
      if (!(parseFloat(r.unit_price) > 0)) return `${tr("سعر الوحدة غير صحيح للمنتج", "Invalid unit price for product")}: ${itemProductName(item)}`;
      if (!String(r.unit || item?.unit || "").trim()) return `${tr("وحدة المنتج مطلوبة", "A unit is required for product")}: ${itemProductName(item)}`;
      const discount = parseFloat(r.discount_pct) || 0;
      const vat = parseFloat(r.vat_pct) || 0;
      if (discount < 0 || discount > 100) return `${tr("نسبة الخصم يجب أن تكون بين 0 و100 للمنتج", "Discount must be between 0 and 100 for product")}: ${itemProductName(item)}`;
      if (vat < 0 || vat > 100) return `${tr("نسبة الضريبة يجب أن تكون بين 0 و100 للمنتج", "VAT must be between 0 and 100 for product")}: ${itemProductName(item)}`;
    }
    if ((parseFloat(header.shipping_cost) || 0) < 0 || (parseFloat(header.other_costs) || 0) < 0) {
      return tr("تكلفة الشحن والمصاريف الأخرى لا يمكن أن تكون سالبة", "Shipping and other costs cannot be negative");
    }
    if (totals.final <= 0) return tr("الإجمالي النهائي يجب أن يكون أكبر من صفر", "The final total must be greater than zero");
    return null;
  };

  const askSave = () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setConfirmOpen(true);
  };

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setConfirmOpen(false);
    setSaving(true);
    try {
      const payload = {
        ...header,
        shipping_cost: parseFloat(header.shipping_cost) || 0,
        other_costs: parseFloat(header.other_costs) || 0,
        items: rows.filter((r) => r.item_id).map((r) => ({
          item_id: r.item_id,
          quantity: parseFloat(r.quantity) || 0,
          unit_price: parseFloat(r.unit_price) || 0,
          discount_pct: parseFloat(r.discount_pct) || 0,
          vat_pct: parseFloat(r.vat_pct) || 0,
        })),
      };
      const { data } = await api.post("/purchases", payload);
      toast.success(`${tr("تم حفظ عملية الشراء بنجاح", "Purchase saved successfully")} — ${tr("رقم العملية", "purchase number")}: ${data.purchase_id}`);
      setHeader(initHeader());
      setRows([emptyRow()]);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const validCount = rows.filter((r) => r.item_id).length;

  return (
    <div className="space-y-4" data-testid="purchases-page">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800" data-testid="legacy-notice">
        {tr("سجل قديم — للمراجعة فقط. المسار الرسمي الجديد للمشتريات يبدأ من طلبات الشراء الواردة.", "Legacy — for historical records only. New procurement now starts from Incoming Purchase Requests.")}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <Section title={tr("بيانات عملية الشراء", "Purchase details")}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{tr("تاريخ الشراء", "Purchase date")} *</Label>
                <Input data-testid="purchase-date-input" type="date" value={header.purchase_date}
                  onChange={(e) => setH("purchase_date", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tr("رقم الفاتورة", "Invoice number")} *</Label>
                <Input data-testid="invoice-number-input" value={header.invoice_number}
                  onChange={(e) => setH("invoice_number", e.target.value)} placeholder={tr("رقم الفاتورة", "Invoice number")} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tr("تاريخ الفاتورة", "Invoice date")}</Label>
                <Input data-testid="invoice-date-input" type="date" value={header.invoice_date}
                  onChange={(e) => setH("invoice_date", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tr("رقم أمر الشراء (تلقائي)", "Purchase order number (automatic)")}</Label>
                <Input data-testid="po-number-input" value={header.po_number}
                  onChange={(e) => setH("po_number", e.target.value)} placeholder={tr("يُنشأ تلقائياً", "Generated automatically")} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tr("أنشأ بواسطة", "Created by")}</Label>
                <Input data-testid="created-by-input" value={header.created_by}
                  onChange={(e) => setH("created_by", e.target.value)} placeholder={tr("اسم الموظف", "Employee name")} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tr("طريقة الدفع", "Payment method")}</Label>
                <Select value={header.payment_method} onValueChange={(v) => setH("payment_method", v)}>
                  <SelectTrigger data-testid="payment-method-select"><SelectValue placeholder={tr("اختر", "Select")} /></SelectTrigger>
                  <SelectContent dir={direction}>
                    {(settings.payment_methods || []).map((m) => (
                      <SelectItem key={m} value={String(m)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">{tr("ملاحظات", "Notes")}</Label>
                <Input data-testid="purchase-notes-input" value={header.notes}
                  onChange={(e) => setH("notes", e.target.value)} placeholder={tr("ملاحظات", "Notes")} />
              </div>
            </div>
          </Section>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Section title={`${tr("المورد", "Supplier")} *`}>
              <Select value={header.supplier_id} onValueChange={(v) => setH("supplier_id", v)}>
                <SelectTrigger data-testid="supplier-select"><SelectValue placeholder={tr("اختر المورد", "Select supplier")} /></SelectTrigger>
                <SelectContent dir={direction}>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {supplier && (
                <div className="mt-3 space-y-1 bg-slate-50 rounded-md p-2" data-testid="supplier-info">
                  <Info label={tr("الكود", "Code")} value={supplier.code} />
                  <Info label={tr("التخصص", "Specialty")} value={supplier.specialty} />
                  <Info label={tr("الهاتف", "Phone")} value={supplier.phone} />
                  <Info label={tr("شروط الدفع", "Payment terms")} value={supplier.payment_terms} />
                </div>
              )}
            </Section>
            <Section title={`${tr("المشروع", "Project")} *`}>
              <Select value={header.project_id} onValueChange={(v) => setH("project_id", v)}>
                <SelectTrigger data-testid="project-select"><SelectValue placeholder={tr("اختر المشروع", "Select project")} /></SelectTrigger>
                <SelectContent dir={direction}>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {project && (
                <div className="mt-3 space-y-1 bg-slate-50 rounded-md p-2" data-testid="project-info">
                  <Info label={tr("الكود", "Code")} value={project.code} />
                  <Info label={tr("المهندس", "Engineer")} value={project.engineer} />
                  <Info label={tr("العنوان", "Address")} value={project.address} />
                </div>
              )}
            </Section>
            <Section title={`${tr("العميل", "Customer")} *`}>
              <Select value={header.customer_id} onValueChange={(v) => setH("customer_id", v)}>
                <SelectTrigger data-testid="customer-select"><SelectValue placeholder={tr("اختر العميل", "Select customer")} /></SelectTrigger>
                <SelectContent dir={direction}>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {customer && (
                <div className="mt-3 space-y-1 bg-slate-50 rounded-md p-2" data-testid="customer-info">
                  <Info label={tr("الكود", "Code")} value={customer.code} />
                  <Info label={tr("الهاتف", "Phone")} value={customer.phone} />
                  <Info label={tr("العنوان", "Address")} value={customer.address} />
                </div>
              )}
            </Section>
          </div>

          <Section title={tr("تفاصيل الأصناف", "Purchase items")} compact>
            <div className="space-y-2" data-testid="purchase-lines-list">
              {rows.map((r, idx) => {
                const item = items.find((i) => i.id === r.item_id);
                const subcategories = subcategoryOptions(items, r.main_category);
                const brands = brandOptions(items, r.main_category, r.subcategory);
                const availableItems = filterItems(items, r.main_category, r.subcategory, r.brand);
                return (
                  <div key={idx} className="min-w-0 rounded-md border border-slate-200 bg-slate-50/40 p-2" data-testid={`item-row-${idx}`}>
                    <div
                      className="grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-[minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,0.75fr)_minmax(0,1.55fr)]"
                      data-testid={`item-selection-row-${idx}`}
                    >
                      <div className="min-w-0 space-y-0.5">
                        <Label className="block truncate text-[10px] leading-3 text-slate-500">{tr("التصنيف الرئيسي", "Main category")}</Label>
                        <SearchableSelect
                          value={r.main_category}
                          onValueChange={(value) => transformRow(idx, (row) => changeMainCategory(row, value))}
                          options={categoryOptions}
                          placeholder={tr("اختر التصنيف الرئيسي", "Select main category")}
                          searchPlaceholder={tr("ابحث في التصنيفات الرئيسية...", "Search main categories...")}
                          testId={`main-category-select-${idx}`}
                        />
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <Label className="block truncate text-[10px] leading-3 text-slate-500">{tr("التصنيف الفرعي", "Subcategory")}</Label>
                        <SearchableSelect
                          value={r.subcategory}
                          onValueChange={(value) => transformRow(idx, (row) => changeSubcategory(row, value))}
                          options={subcategories}
                          placeholder={tr("اختر التصنيف الفرعي", "Select subcategory")}
                          searchPlaceholder={tr("ابحث في التصنيفات الفرعية...", "Search subcategories...")}
                          disabled={!r.main_category}
                          testId={`subcategory-select-${idx}`}
                        />
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <Label className="block truncate text-[10px] leading-3 text-slate-500">{tr("العلامة التجارية", "Brand")}</Label>
                        <SearchableSelect
                          value={r.brand}
                          onValueChange={(value) => transformRow(idx, (row) => changeBrand(row, value))}
                          options={brands}
                          placeholder={tr("اختر العلامة التجارية", "Select brand")}
                          searchPlaceholder={tr("ابحث في العلامات التجارية...", "Search brands...")}
                          disabled={!r.main_category || !r.subcategory}
                          testId={`brand-select-${idx}`}
                        />
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <Label className="block truncate text-[10px] leading-3 text-slate-500">{tr("اسم المنتج", "Product name")}</Label>
                        <SearchableSelect
                          value={r.item_id}
                          onValueChange={(value) => {
                            const selected = items.find((candidate) => candidate.id === value);
                            if (selected) transformRow(idx, (row) => selectItem(row, selected));
                          }}
                          options={availableItems.map((candidate) => ({
                            value: candidate.id,
                            label: itemProductName(candidate),
                            searchText: [
                              candidate.code, candidate.name, candidate.brand,
                              candidate.main_category, candidate.subcategory,
                              candidate.specifications || candidate.specs,
                            ].filter(Boolean).join(" "),
                          }))}
                          placeholder={tr("اختر المنتج", "Select product")}
                          searchPlaceholder={tr("ابحث باسم المنتج أو الكود...", "Search by product name or code...")}
                          disabled={!r.main_category || !r.subcategory || !r.brand}
                          testId={`item-select-${idx}`}
                          selectedTitle
                        />
                      </div>
                    </div>

                    <div
                      className="mt-1.5 grid min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,0.48fr)_minmax(0,0.72fr)_minmax(0,0.9fr)_minmax(0,0.68fr)_minmax(0,0.7fr)_minmax(0,1.05fr)_2rem]"
                      data-testid={`purchase-values-row-${idx}`}
                    >
                      <div className="min-w-0 space-y-0.5">
                        <Label className="block truncate text-[10px] leading-3 text-slate-500">{tr("كود الصنف", "Item code")}</Label>
                        <div className="flex h-8 min-w-0 items-center rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-500" data-testid={`item-code-${idx}`}>
                          <span className="truncate" title={r.item_code || item?.code || ""}>{r.item_code || item?.code || "-"}</span>
                        </div>
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <Label className="block truncate text-[10px] leading-3 text-slate-500">{tr("الوحدة", "Unit")}</Label>
                        <div className="flex h-8 min-w-0 items-center rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-500" data-testid={`item-unit-${idx}`}>
                          <span className="truncate" title={r.unit || item?.unit || ""}>{r.unit || item?.unit || "-"}</span>
                        </div>
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <Label className="block truncate text-[10px] leading-3 text-slate-500">{tr("الكمية", "Quantity")}</Label>
                        <Input className="h-8 min-w-0 px-2 text-xs" type="number" min="0" data-testid={`quantity-input-${idx}`}
                          value={r.quantity} onChange={(e) => setRow(idx, "quantity", e.target.value)} />
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <Label className="block truncate text-[10px] leading-3 text-slate-500">{tr("سعر الوحدة", "Unit price")}</Label>
                        <Input className="h-8 min-w-0 px-2 text-xs" type="number" min="0" data-testid={`unit-price-input-${idx}`}
                          value={r.unit_price} onChange={(e) => setRow(idx, "unit_price", e.target.value)} />
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <Label className="block truncate text-[10px] leading-3 text-slate-500">{tr("الخصم %", "Discount %")}</Label>
                        <Input className="h-8 min-w-0 px-2 text-xs" type="number" min="0" max="100" data-testid={`discount-input-${idx}`}
                          value={r.discount_pct} onChange={(e) => setRow(idx, "discount_pct", e.target.value)} />
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <Label className="block truncate text-[10px] leading-3 text-slate-500">{tr("الضريبة %", "VAT %")}</Label>
                        <Select value={String(r.vat_pct)} onValueChange={(v) => setRow(idx, "vat_pct", v)}>
                          <SelectTrigger className="h-8 min-w-0 px-2 text-xs" data-testid={`vat-select-${idx}`}>
                            <SelectValue placeholder="0" />
                          </SelectTrigger>
                          <SelectContent dir={direction}>
                            {(settings.vat_rates || [0, 14]).map((v) => (
                              <SelectItem key={v} value={String(v)}>{v}%</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <Label className="block truncate text-[10px] font-semibold leading-3 text-primary">{tr("الإجمالي", "Total")}</Label>
                        <div className="flex h-8 min-w-0 items-center rounded-md border border-primary/20 bg-primary/5 px-2 text-xs font-bold text-primary" data-testid={`line-total-${idx}`}>
                          <span className="truncate" title={r.item_id ? fmtEGP(lineTotal(r)) : ""}>{r.item_id ? fmtEGP(lineTotal(r)) : "-"}</span>
                        </div>
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <Label className="block truncate text-center text-[10px] leading-3 text-slate-500">{tr("حذف", "Delete")}</Label>
                        <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`remove-row-${idx}`}
                          aria-label={`${tr("حذف الصنف", "Delete item")} ${idx + 1}`}
                          onClick={() => setRows((rs) => rs.length > 1 ? rs.filter((_, i) => i !== idx) : [emptyRow()])}>
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <Button variant="outline" size="sm" className="mt-2 h-8 gap-1" data-testid="add-item-row-button"
              onClick={() => setRows((rs) => [...rs, emptyRow()])}>
              <Plus className="h-3.5 w-3.5" /> {tr("إضافة صنف", "Add item")}
            </Button>
          </Section>
        </div>

        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4 sticky top-20" data-testid="financial-summary">
            <h3 className="text-sm font-bold text-primary mb-4">{tr("الملخص المالي", "Financial summary")}</h3>
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">{tr("الإجمالي قبل الخصم", "Subtotal")}</span><span className="font-medium" data-testid="summary-subtotal">{fmtEGP(totals.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{tr("قيمة الخصم", "Discount")}</span><span className="font-medium text-amber-600" data-testid="summary-discount">{fmtEGP(totals.discount)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{tr("الإجمالي بعد الخصم", "After discount")}</span><span className="font-medium" data-testid="summary-after-discount">{fmtEGP(totals.afterDiscount)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{tr("قيمة الضريبة", "VAT")}</span><span className="font-medium" data-testid="summary-vat">{fmtEGP(totals.vat)}</span></div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-slate-500">{tr("تكلفة الشحن", "Shipping cost")}</span>
                <Input className="h-7 w-28 text-xs" type="number" min="0" data-testid="shipping-cost-input"
                  value={header.shipping_cost} onChange={(e) => setH("shipping_cost", e.target.value)} />
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-slate-500">{tr("مصاريف أخرى", "Other costs")}</span>
                <Input className="h-7 w-28 text-xs" type="number" min="0" data-testid="other-costs-input"
                  value={header.other_costs} onChange={(e) => setH("other_costs", e.target.value)} />
              </div>
              <div className="border-t border-slate-200 pt-3 flex justify-between items-center">
                <span className="font-bold text-slate-800">{tr("الإجمالي النهائي", "Final total")}</span>
                <span className="font-bold text-lg text-primary" data-testid="summary-final-total">{fmtEGP(totals.final)}</span>
              </div>
            </div>
            <Button className="w-full mt-4 gap-2" data-testid="save-purchase-button" onClick={askSave} disabled={saving}>
              <Save className="h-4 w-4" /> {saving ? tr("جارٍ الحفظ...", "Saving...") : tr("حفظ عملية الشراء", "Save purchase")}
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent dir={direction}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-start">{tr("تأكيد الحفظ", "Confirm save")}</AlertDialogTitle>
            <AlertDialogDescription className="text-start leading-7">
              {tr("هل تريد حفظ عملية الشراء؟", "Save this purchase?")}<br />
              {tr("رقم الفاتورة", "Invoice number")}: <b>{header.invoice_number}</b><br />
              {tr("المورد", "Supplier")}: <b>{supplier?.name}</b><br />
              {tr("المشروع", "Project")}: <b>{project?.name}</b><br />
              {tr("عدد الأصناف", "Item count")}: <b>{validCount}</b><br />
              {tr("الإجمالي النهائي", "Final total")}: <b>{fmtEGP(totals.final)}</b>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>{tr("إلغاء", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="confirm-save-purchase" onClick={save}>{tr("حفظ", "Save")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
