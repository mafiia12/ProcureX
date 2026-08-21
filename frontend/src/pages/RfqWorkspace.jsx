import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, FileUp, Paperclip, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import SearchableSelect from "@/components/SearchableSelect";
import api, { errMsg, fmtEGP } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const QUOTATION_STATUS_LABEL = {
  draft: "مسودة", received: "تم الاستلام", withdrawn: "منسحب",
};
const QUOTATION_STATUS_STYLE = {
  draft: "bg-slate-100 text-slate-700",
  received: "bg-emerald-100 text-emerald-800",
  withdrawn: "bg-red-100 text-red-700",
};

const emptyQuotationForm = () => ({
  quotation_ref: "", quotation_date: "", valid_until: "",
  payment_terms: "", delivery_terms: "", currency: "EGP", notes: "",
});

export default function RfqWorkspace() {
  const { rfqId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role || "";
  const canManage = role === "admin" || role === "procurement_responsible";

  const [rfq, setRfq] = useState(null);
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierChoice, setSupplierChoice] = useState("");
  const [addingSupplier, setAddingSupplier] = useState(false);

  const [quotationOpen, setQuotationOpen] = useState(false);
  const [activeSupplier, setActiveSupplier] = useState(null);
  const [activeQuotationId, setActiveQuotationId] = useState("");
  const [quotationForm, setQuotationForm] = useState(emptyQuotationForm());
  const [quotationLines, setQuotationLines] = useState([]);
  const [savingQuotation, setSavingQuotation] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [existingAttachmentCount, setExistingAttachmentCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/workflow/rfqs/${rfqId}`);
      setRfq(data);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setLoading(false);
    }
  }, [rfqId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get("/suppliers").then(({ data }) => setSuppliers(data)).catch(() => setSuppliers([]));
  }, []);

  const addSupplier = async () => {
    if (!supplierChoice) return toast.error("اختر المورد أولاً");
    setAddingSupplier(true);
    try {
      await api.post(`/workflow/rfqs/${rfqId}/suppliers`, { supplier_id: supplierChoice });
      setSupplierChoice("");
      toast.success("تمت إضافة المورد لطلب التسعير");
      await load();
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setAddingSupplier(false);
    }
  };

  const quotationFor = (supplierId) =>
    (rfq?.quotations || []).find((quotation) => quotation.supplier_id === supplierId);

  const openQuotation = async (rfqSupplier) => {
    setActiveSupplier(rfqSupplier);
    setQuotationOpen(true);
    try {
      const { data } = await api.post(`/workflow/rfqs/${rfqId}/quotations`, {
        supplier_id: rfqSupplier.supplier_id,
      });
      const quotation = data.quotation;
      setActiveQuotationId(quotation.id);
      setQuotationForm({
        quotation_ref: quotation.quotation_ref || "",
        quotation_date: quotation.quotation_date || "",
        valid_until: quotation.valid_until || "",
        payment_terms: quotation.payment_terms || "",
        delivery_terms: quotation.delivery_terms || "",
        currency: quotation.currency || "EGP",
        notes: quotation.notes || "",
      });
      setExistingAttachmentCount(quotation.attachment_count || 0);
      const linesByItem = Object.fromEntries(
        (quotation.lines || []).map((line) => [line.rfq_item_id, line]),
      );
      setQuotationLines((rfq?.items || []).map((item) => {
        const existing = linesByItem[item.id];
        return {
          rfq_item_id: item.id,
          product_name: item.product_name,
          quantity: existing ? existing.quantity : item.quantity,
          unit: existing ? existing.unit : item.unit,
          unit_price: existing ? existing.unit_price : 0,
          availability: existing ? existing.availability : "available",
          remark: existing ? existing.remark : "",
        };
      }));
      setPendingFiles([]);
    } catch (error) {
      toast.error(errMsg(error));
      setQuotationOpen(false);
    }
  };

  const setLineField = (index, key, value) => {
    setQuotationLines((current) => current.map((line, i) => (
      i === index ? { ...line, [key]: value } : line
    )));
  };

  const saveQuotation = async (status) => {
    setSavingQuotation(true);
    try {
      const payload = {
        ...quotationForm,
        status,
        lines: quotationLines.map((line) => ({
          rfq_item_id: line.rfq_item_id,
          quantity: Number(line.quantity) || 0,
          unit: line.unit,
          unit_price: Number(line.unit_price) || 0,
          availability: line.availability,
          remark: line.remark,
        })),
      };
      await api.put(`/workflow/rfqs/${rfqId}/quotations/${activeQuotationId}`, payload);
      if (pendingFiles.length) {
        const form = new FormData();
        pendingFiles.forEach((file) => form.append("files", file));
        await api.post(
          `/workflow/rfqs/${rfqId}/quotations/${activeQuotationId}/attachments`,
          form,
        );
        setPendingFiles([]);
      }
      toast.success(status === "received" ? "تم تسجيل استلام عرض السعر" : "تم حفظ المسودة");
      setQuotationOpen(false);
      await load();
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setSavingQuotation(false);
    }
  };

  const prepareComparison = async () => {
    try {
      const { data } = await api.get(`/workflow/rfqs/${rfqId}/comparison-rows`);
      if (!data.rows.length) {
        toast.error("لا توجد عروض أسعار مستلمة بعد لتجهيز المقارنة");
        return;
      }
      navigate("/supplier-price-comparison", {
        state: {
          sourceRequest: {
            request_id: data.source_request_id,
            request_number: data.source_request_number,
            project_name: data.project_name,
            items: [],
          },
          rfqRows: data.rows,
          rfqId: data.rfq_id,
          supplierQuotations: data.supplier_quotations || [],
        },
      });
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  if (loading) return <div className="py-20 text-center text-slate-400">جارٍ التحميل...</div>;
  if (!rfq) return <div className="py-20 text-center text-slate-400">طلب التسعير غير موجود.</div>;

  const supplierOptions = suppliers
    .filter((supplier) => !rfq.suppliers.some((row) => row.supplier_id === supplier.id))
    .map((supplier) => ({ value: supplier.id, label: `${supplier.code} — ${supplier.name}`, searchText: supplier.name }));

  return (
    <div className="space-y-4" dir="rtl" data-testid="rfq-workspace-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900" data-testid="rfq-number">{rfq.rfq_number}</h2>
          <p className="mt-1 text-sm text-slate-500">
            الطلب المصدر: {rfq.source_request_number} · المشروع: {rfq.project_name || "-"}
            {rfq.deadline && <> · الموعد النهائي: {rfq.deadline}</>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/incoming-requests")}>
            <ArrowRight className="h-4 w-4" /> رجوع للطلبات
          </Button>
          <Button onClick={prepareComparison} data-testid="prepare-comparison-button">
            <Send className="h-4 w-4" /> تجهيز مقارنة الأسعار ({rfq.received_quotation_count})
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-bold text-slate-800">الأصناف المطلوبة</h3>
        <div className="space-y-2">
          {rfq.items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
              <div>
                <span className="font-bold">{item.product_name}</span>
                {item.specifications && <span className="text-slate-500"> — {item.specifications}</span>}
              </div>
              <div className="text-slate-600">{item.quantity} {item.unit}</div>
            </div>
          ))}
        </div>
      </div>

      {canManage && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-bold text-slate-800">إضافة مورد</h3>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-72">
              <SearchableSelect
                value={supplierChoice}
                onValueChange={setSupplierChoice}
                options={supplierOptions}
                placeholder="اختر موردًا"
                searchPlaceholder="ابحث عن مورد..."
                testId="rfq-supplier-select"
              />
            </div>
            <Button onClick={addSupplier} disabled={addingSupplier} data-testid="rfq-add-supplier-button">
              <Plus className="h-4 w-4" /> إضافة مورد
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-bold text-slate-800">عروض أسعار الموردين</h3>
        {!rfq.suppliers.length ? (
          <div className="rounded-md border border-dashed bg-slate-50 p-6 text-center text-sm text-slate-500">
            لم تتم إضافة موردين بعد.
          </div>
        ) : (
          <div className="space-y-2">
            {rfq.suppliers.map((row) => {
              const quotation = quotationFor(row.supplier_id);
              return (
                <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 p-3" data-testid="rfq-supplier-row">
                  <div>
                    <div className="font-bold text-slate-900">{row.supplier_name}</div>
                    {quotation ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <Badge className={QUOTATION_STATUS_STYLE[quotation.status]}>{QUOTATION_STATUS_LABEL[quotation.status]}</Badge>
                        {quotation.quotation_ref && <span>مرجع: {quotation.quotation_ref}</span>}
                        <span>الإجمالي: {fmtEGP(quotation.total_value)}</span>
                        <span className="flex items-center gap-1"><Paperclip className="h-3 w-3" /> {quotation.attachment_count}</span>
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-slate-400">لم يُسجَّل عرض سعر بعد</div>
                    )}
                  </div>
                  {canManage && (
                    <Button size="sm" variant="outline" onClick={() => openQuotation(row)} data-testid="rfq-open-quotation-button">
                      {quotation ? "تعديل العرض" : "تسجيل عرض سعر"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={quotationOpen} onOpenChange={setQuotationOpen}>
        <DialogContent dir="rtl" className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="quotation-dialog">
          <DialogHeader>
            <DialogTitle className="text-start">عرض سعر — {activeSupplier?.supplier_name}</DialogTitle>
            <DialogDescription className="text-start">سجّل بيانات عرض السعر ثم احفظه كمسودة أو سجّل الاستلام.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">مرجع عرض السعر</Label>
              <Input data-testid="quotation-ref-input" value={quotationForm.quotation_ref} onChange={(e) => setQuotationForm((f) => ({ ...f, quotation_ref: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">تاريخ العرض</Label>
              <Input type="date" value={quotationForm.quotation_date} onChange={(e) => setQuotationForm((f) => ({ ...f, quotation_date: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">صالح حتى</Label>
              <Input type="date" value={quotationForm.valid_until} onChange={(e) => setQuotationForm((f) => ({ ...f, valid_until: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">شروط الدفع</Label>
              <Input value={quotationForm.payment_terms} onChange={(e) => setQuotationForm((f) => ({ ...f, payment_terms: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">شروط التسليم</Label>
              <Input value={quotationForm.delivery_terms} onChange={(e) => setQuotationForm((f) => ({ ...f, delivery_terms: e.target.value }))} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">ملاحظات</Label>
              <Textarea rows={2} value={quotationForm.notes} onChange={(e) => setQuotationForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          <div className="mt-3 space-y-2">
            <Label className="text-xs font-bold">الأصناف</Label>
            {quotationLines.map((line, index) => (
              <div key={line.rfq_item_id} className="grid grid-cols-6 gap-2 rounded-md border border-slate-100 p-2 text-xs" data-testid="quotation-line-row">
                <div className="col-span-2 flex items-center font-bold">{line.product_name}</div>
                <Input className="h-8" type="number" min="0" value={line.quantity} onChange={(e) => setLineField(index, "quantity", e.target.value)} />
                <Input className="h-8" value={line.unit} onChange={(e) => setLineField(index, "unit", e.target.value)} />
                <Input className="h-8" type="number" min="0" placeholder="سعر الوحدة" value={line.unit_price} onChange={(e) => setLineField(index, "unit_price", e.target.value)} />
                <Select value={line.availability} onValueChange={(v) => setLineField(index, "availability", v)}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="available">متاح</SelectItem>
                    <SelectItem value="unavailable">غير متاح</SelectItem>
                  </SelectContent>
                </Select>
                <Input className="col-span-6 h-8" placeholder="ملاحظات المورد" value={line.remark} onChange={(e) => setLineField(index, "remark", e.target.value)} />
              </div>
            ))}
          </div>

          <div className="mt-3 space-y-2">
            <Label className="text-xs font-bold">المرفقات ({existingAttachmentCount + pendingFiles.length})</Label>
            <Input
              type="file" multiple data-testid="quotation-attachments-input"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx"
              onChange={(e) => setPendingFiles(Array.from(e.target.files || []))}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => saveQuotation("draft")} disabled={savingQuotation} data-testid="save-draft-button">
              <FileUp className="h-4 w-4" /> حفظ مسودة
            </Button>
            <Button onClick={() => saveQuotation("received")} disabled={savingQuotation} data-testid="mark-received-button">
              تسجيل الاستلام
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
