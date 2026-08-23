import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Search, Eye, Trash2, FileDown, FileUp } from "lucide-react";
import api, { fmtEGP, errMsg, STATUS_STYLES } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function PurchaseRegister() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [detail, setDetail] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef();

  const load = () => api.get("/purchases").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let out = rows;
    if (statusFilter !== "all") out = out.filter((r) => r.payment_status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r) =>
        [r.purchase_id, r.invoice_number, r.supplier_name, r.project_name, r.customer_name,
          r.item_search]
          .some((v) => String(v ?? "").toLowerCase().includes(q)));
    }
    return out;
  }, [rows, search, statusFilter]);

  const showDetail = async (purchaseId) => {
    const { data } = await api.get(`/purchases/${purchaseId}`);
    setDetail(data);
  };

  const doDelete = async () => {
    try {
      await api.delete(`/purchases/${deleting.purchase_id}`);
      toast.success("تم حذف عملية الشراء وكل السجلات المرتبطة بها");
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const exportExcel = async () => {
    try {
      const response = await api.get("/export/excel", { responseType: "blob" });
      const blob = response.data;
      if (!(blob instanceof Blob) || blob.size === 0) throw new Error("empty-export-response");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `RE_DECOR_Procurement_ERP_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const importExcel = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/import/excel", fd);
      const c = data.imported;
      toast.success(`تم الاستيراد بنجاح: ${c.purchases} عملية، ${c.suppliers} مورد، ${c.items} صنف، ${c.payments} دفعة`);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-4" data-testid="register-page">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800" data-testid="legacy-notice">
        سجل قديم — للمراجعة فقط. المسار الرسمي الجديد للمشتريات يبدأ من طلبات الشراء الواردة.
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative w-72">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input data-testid="register-search-input" className="ps-9 bg-white" placeholder="بحث برقم العملية أو الفاتورة أو المورد..."
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 bg-white" data-testid="status-filter-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="all">كل الحالات</SelectItem>
              <SelectItem value="مدفوع">مدفوع</SelectItem>
              <SelectItem value="مدفوع جزئي">مدفوع جزئي</SelectItem>
              <SelectItem value="غير مدفوع">غير مدفوع</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={importExcel} data-testid="import-file-input" />
          <Button variant="outline" className="gap-2" data-testid="import-excel-button"
            onClick={() => fileRef.current?.click()} disabled={importing}>
            <FileUp className="h-4 w-4" /> {importing ? "جارٍ الاستيراد..." : "استيراد Excel"}
          </Button>
          <Button variant="outline" className="gap-2" data-testid="export-excel-button" onClick={exportExcel}>
            <FileDown className="h-4 w-4" /> تصدير Excel
          </Button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              {["رقم العملية", "تاريخ الشراء", "رقم الفاتورة", "المورد", "المشروع", "العميل",
                "إجمالي الفاتورة", "المدفوع", "المتبقي", "حالة الدفع", "إجراءات"].map((h) => (
                <TableHead key={h} className="text-start text-xs font-bold text-slate-600 whitespace-nowrap">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={11} className="text-center text-slate-400 py-10">لا توجد عمليات شراء</TableCell></TableRow>
            ) : filtered.map((r) => (
              <TableRow key={r.id} className="hover:bg-slate-50" data-testid="register-row">
                <TableCell className="py-2 text-sm font-semibold text-primary">{r.purchase_id}</TableCell>
                <TableCell className="py-2 text-sm">{r.purchase_date}</TableCell>
                <TableCell className="py-2 text-sm">{r.invoice_number}</TableCell>
                <TableCell className="py-2 text-sm">{r.supplier_name}</TableCell>
                <TableCell className="py-2 text-sm">{r.project_name}</TableCell>
                <TableCell className="py-2 text-sm">{r.customer_name}</TableCell>
                <TableCell className="py-2 text-sm font-semibold">{fmtEGP(r.invoice_total)}</TableCell>
                <TableCell className="py-2 text-sm text-emerald-600">{fmtEGP(r.paid_amount)}</TableCell>
                <TableCell className="py-2 text-sm text-red-600">{fmtEGP(r.remaining)}</TableCell>
                <TableCell className="py-2">
                  <Badge className={`${STATUS_STYLES[r.payment_status] || "bg-slate-100 text-slate-600"} hover:bg-inherit text-xs font-normal`}>
                    {r.payment_status}
                  </Badge>
                </TableCell>
                <TableCell className="py-2">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" data-testid="view-purchase-button"
                      onClick={() => showDetail(r.purchase_id)}>
                      <Eye className="h-3.5 w-3.5 text-slate-500" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" data-testid="delete-purchase-button"
                      onClick={() => setDeleting(r)}>
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="text-xs text-slate-500">إجمالي العمليات: {filtered.length}</div>

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent dir="rtl" className="max-w-6xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-start">تفاصيل عملية الشراء {detail?.purchase_id}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4" data-testid="purchase-detail">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {[["رقم أمر الشراء", detail.po_number], ["تاريخ الشراء", detail.purchase_date],
                  ["رقم الفاتورة", detail.invoice_number], ["المورد", detail.supplier_name],
                  ["المشروع", detail.project_name], ["العميل", detail.customer_name],
                  ["طريقة الدفع", detail.payment_method || "-"], ["حالة الدفع", detail.payment_status]].map(([l, v]) => (
                  <div key={l}><div className="text-xs text-slate-400">{l}</div><div className="font-medium">{v}</div></div>
                ))}
              </div>
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    {["المنتج", "العلامة التجارية", "التصنيف الرئيسي", "التصنيف الفرعي",
                      "المواصفات", "الكود", "الوحدة", "الكمية", "سعر الوحدة", "الخصم %",
                      "الضريبة %", "الإجمالي"].map((h) => (
                      <TableHead key={h} className="text-start text-xs">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="py-1.5 text-sm">{i.product_name || i.item_name}</TableCell>
                      <TableCell className="py-1.5 text-sm">{i.brand || "-"}</TableCell>
                      <TableCell className="py-1.5 text-sm">{i.main_category || "-"}</TableCell>
                      <TableCell className="py-1.5 text-sm">{i.subcategory || "-"}</TableCell>
                      <TableCell className="py-1.5 text-sm max-w-56 truncate" title={i.specifications || ""}>{i.specifications || "-"}</TableCell>
                      <TableCell className="py-1.5 text-sm">{i.item_code}</TableCell>
                      <TableCell className="py-1.5 text-sm">{i.unit}</TableCell>
                      <TableCell className="py-1.5 text-sm">{i.quantity}</TableCell>
                      <TableCell className="py-1.5 text-sm">{fmtEGP(i.unit_price)}</TableCell>
                      <TableCell className="py-1.5 text-sm">{i.discount_pct}%</TableCell>
                      <TableCell className="py-1.5 text-sm">{i.vat_pct}%</TableCell>
                      <TableCell className="py-1.5 text-sm font-semibold">{fmtEGP(i.line_total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
              <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm bg-slate-50 rounded-md p-3">
                <span>قبل الخصم: <b>{fmtEGP(detail.subtotal)}</b></span>
                <span>الخصم: <b>{fmtEGP(detail.discount_total)}</b></span>
                <span>الضريبة: <b>{fmtEGP(detail.vat_total)}</b></span>
                <span>الإجمالي النهائي: <b className="text-primary">{fmtEGP(detail.invoice_total)}</b></span>
                <span>المدفوع: <b className="text-emerald-600">{fmtEGP(detail.paid_amount)}</b></span>
                <span>المتبقي: <b className="text-red-600">{fmtEGP(detail.remaining)}</b></span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-start">تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription className="text-start">
              هل أنت متأكد من حذف عملية الشراء {deleting?.purchase_id}؟ سيتم حذف الأصناف والدفعات المرتبطة بها.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction data-testid="confirm-delete-purchase" onClick={doDelete}
              className="bg-red-600 hover:bg-red-700">حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
