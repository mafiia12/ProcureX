import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, ClipboardCopy, MessageCircle, Printer } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg, fmtEGP } from "@/lib/api";
import { Button } from "@/components/ui/button";

export default function PurchaseOrderReport() {
  const { purchaseOrderId, audience } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const isSite = audience === "site";
  useEffect(() => { api.get(`/purchase-orders/${purchaseOrderId}/reports/${audience}`).then(({ data }) => setReport(data)).catch((error) => toast.error(errMsg(error))); }, [purchaseOrderId, audience]);
  const shareText = useMemo(() => !report ? "" : isSite
    ? `إشعار توريد للمشروع: ${report.project_name}\nرقم أمر الشراء/التوريد: ${report.po_number}\nيرجى مراجعة الأصناف والكميات قبل الاستلام.`
    : `تم تنفيذ أمر الشراء للمشروع: ${report.project_name}\nرقم أمر الشراء: ${report.po_number}\nالإجمالي: ${fmtEGP(report.totals.final_total)}\nالحالة: قيد التوريد.`, [report, isSite]);
  if (!report) return <div className="p-12 text-center">جارٍ تجهيز التقرير...</div>;
  const copy = async () => { await navigator.clipboard.writeText(shareText); toast.success("تم نسخ نص المشاركة"); };
  const whatsapp = () => window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank", "noopener,noreferrer");
  return <div className="min-h-screen bg-slate-100 p-4 print:bg-white print:p-0" dir="rtl" data-testid={isSite ? "site-delivery-report" : "admin-delivery-report"}>
    <style>{`@page{size:A4;margin:12mm}@media print{body{background:#fff}.report-actions,.local-note{display:none!important}.report-sheet{box-shadow:none!important;border:0!important;margin:0!important;max-width:none!important}table{page-break-inside:auto}tr{page-break-inside:avoid}}`}</style>
    <div className="report-actions mx-auto mb-3 flex max-w-5xl flex-wrap justify-between gap-2"><Button variant="outline" onClick={() => navigate(`/purchase-orders/${purchaseOrderId}`)}><ArrowRight className="h-4 w-4" /> رجوع لأمر الشراء</Button><div className="flex gap-2"><Button variant="outline" onClick={copy}><ClipboardCopy className="h-4 w-4" /> نسخ النص</Button><Button variant="outline" onClick={whatsapp}><MessageCircle className="h-4 w-4" /> واتساب</Button><Button onClick={() => window.print()}><Printer className="h-4 w-4" /> طباعة / حفظ PDF</Button></div></div>
    <div className="local-note mx-auto mb-3 max-w-5xl rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">في التشغيل المحلي يفتح واتساب بنص جاهز فقط؛ اطبع أو احفظ التقرير PDF وأرفقه يدويًا. لا يوجد رابط عام قابل للمشاركة حاليًا.</div>
    <main className="report-sheet mx-auto max-w-5xl rounded-xl border bg-white p-8 shadow-sm">
      <header className="border-b-2 border-slate-900 pb-5 text-center"><div className="text-lg font-black tracking-wide">RE DECOR & MORE</div><h1 className="mt-2 text-2xl font-black">{report.title}</h1><div className="mt-2 inline-flex rounded-full bg-blue-100 px-3 py-1 text-sm font-bold text-blue-800">{report.status}</div></header>
      <section className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 text-sm md:grid-cols-4">{([["المشروع", report.project_name], ["المورد", report.supplier_name], ["رقم أمر الشراء", report.po_number], [isSite ? "مرجع التوريد" : "طلب الشراء", isSite ? report.delivery_reference : report.request_number], ...(isSite ? [] : [["العميل", report.customer_name], ["المقارنة", report.comparison_number], ["الاعتماد", report.approval_number], ["تاريخ التنفيذ", report.execution_date], ["أعده", report.prepared_by]])]).map(([label, value]) => <div key={label}><div className="text-xs text-slate-500">{label}</div><b>{value || "-"}</b></div>)}</section>
      <table className="mt-6 w-full border-collapse text-sm"><thead><tr className="bg-slate-900 text-white"><th className="p-2">#</th><th className="p-2 text-start">الصنف والمواصفات</th><th className="p-2">الكمية</th>{!isSite && <><th className="p-2">سعر الوحدة</th><th className="p-2">الخصم</th><th className="p-2">الضريبة</th><th className="p-2">الشحن</th><th className="p-2">إجمالي البند</th></>}</tr></thead><tbody>{report.items.map((item) => <tr key={item.position} className="border-b"><td className="p-2 text-center">{item.position}</td><td className="p-2"><b>{item.product_name}</b><div className="text-xs text-slate-500">{[item.item_code, item.brand, item.specifications].filter(Boolean).join(" · ")}</div></td><td className="p-2 text-center">{item.quantity} {item.unit}</td>{!isSite && <><td className="p-2 text-center">{fmtEGP(item.unit_price)}</td><td className="p-2 text-center">{item.discount_pct}%</td><td className="p-2 text-center">{item.vat_pct}%</td><td className="p-2 text-center">{fmtEGP(item.shipping_cost)}</td><td className="p-2 text-center font-bold">{fmtEGP(item.line_total)}</td></>}</tr>)}</tbody></table>
      {!isSite ? <section className="mt-5 ms-auto grid max-w-md grid-cols-2 gap-2 text-sm">{[["الإجمالي قبل الخصم", report.totals.subtotal], ["الخصم", report.totals.discount_total], ["الضريبة", report.totals.vat_total], ["الشحن", report.totals.shipping_total], ["تكاليف أخرى", report.totals.other_total], ["الإجمالي النهائي", report.totals.final_total]].map(([label, value]) => <div key={label} className={`flex justify-between rounded p-2 ${label === "الإجمالي النهائي" ? "bg-slate-900 font-black text-white" : "bg-slate-50"}`}><span>{label}</span><span>{fmtEGP(value)}</span></div>)}</section> : <div className="mt-6 rounded-lg border-2 border-blue-200 bg-blue-50 p-4 text-center font-black text-blue-900">{report.receiving_instruction}</div>}
      <section className="mt-6 grid gap-3 text-sm md:grid-cols-2"><div><b>{isSite ? "تعليمات / ملاحظات" : "شروط الدفع ومدة التوريد"}</b><p className="mt-1 text-slate-600">{isSite ? report.notes || "-" : `${report.payment_terms || "-"} · ${report.delivery_days ? `${report.delivery_days} يوم` : "-"}`}</p></div><div className="text-end text-xs text-slate-400">تاريخ إنشاء التقرير: {new Date(report.generated_at).toLocaleString("ar-EG")}</div></section>
    </main>
  </div>;
}
