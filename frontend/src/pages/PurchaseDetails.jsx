import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, FileCheck2, FileText, FolderKanban, Scale, ShoppingCart } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import ProcurementProgress from "@/components/ProcurementProgress";

const money = (value, currency = "EGP") => `${Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ${currency}`;

export default function PurchaseDetails() {
  const { purchaseId } = useParams();
  const navigate = useNavigate();
  const [purchase, setPurchase] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/purchases/${encodeURIComponent(purchaseId)}`)
      .then(({ data }) => setPurchase(data))
      .catch((requestError) => setError(requestError?.response?.data?.detail || "تعذر تحميل عملية الشراء"));
  }, [purchaseId]);

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</div>;
  if (!purchase) return <div className="rounded-xl border bg-white p-8 text-center text-slate-500">جارٍ تحميل تفاصيل الشراء...</div>;
  const related = purchase.related || {};

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-black text-slate-900">عملية الشراء {purchase.purchase_id}</h2><p className="text-sm text-slate-500">سجل موجود للعرض والمتابعة، وليس نموذج إنشاء جديدًا.</p></div>
      <Button variant="outline" onClick={() => navigate(-1)}><ArrowRight className="h-4 w-4" /> رجوع</Button>
    </div>
    <ProcurementProgress currentStage={7} />
    <section className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-3">
      {[["المشروع", purchase.project_name], ["المورد", purchase.supplier_name], ["العميل", purchase.customer_name], ["تاريخ الشراء", purchase.purchase_date], ["رقم الفاتورة", purchase.invoice_number], ["أمر الشراء", related.purchase_order_number || purchase.po_number || "-"], ["حالة الدفع", purchase.payment_status], ["طريقة الدفع", purchase.payment_method], ["تاريخ الاستحقاق", purchase.due_date]].map(([label, value]) => <div key={label}><div className="text-xs text-slate-500">{label}</div><div className="font-bold text-slate-900">{value || "-"}</div></div>)}
    </section>
    <section className="overflow-hidden rounded-xl border bg-white"><div className="border-b px-4 py-3 font-bold">الأصناف</div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50 text-slate-600"><tr><th className="p-3 text-start">الصنف</th><th className="p-3">الكمية</th><th className="p-3">سعر الوحدة</th><th className="p-3">الخصم</th><th className="p-3">الضريبة</th><th className="p-3">الشحن</th><th className="p-3">الإجمالي</th></tr></thead><tbody>{(purchase.items || []).map((item) => <tr key={item.id} className="border-t"><td className="p-3"><b>{item.product_name || item.item_name}</b><div className="text-xs text-slate-500">{[item.brand, item.specifications].filter(Boolean).join(" · ")}</div></td><td className="p-3 text-center">{item.quantity} {item.unit}</td><td className="p-3 text-center">{money(item.unit_price, purchase.currency)}</td><td className="p-3 text-center">{Number(item.discount_pct || 0).toLocaleString("ar-EG")}%</td><td className="p-3 text-center">{Number(item.vat_pct || item.tax_pct || 0).toLocaleString("ar-EG")}%</td><td className="p-3 text-center">{money(item.shipping_cost, purchase.currency)}</td><td className="p-3 text-center font-bold">{money(item.line_total || Number(item.quantity || 0) * Number(item.unit_price || 0), purchase.currency)}</td></tr>)}</tbody></table></div></section>
    <section className="grid gap-3 md:grid-cols-3"><div className="rounded-xl border bg-white p-4"><div className="text-xs text-slate-500">إجمالي الفاتورة</div><div className="mt-1 text-xl font-black">{money(purchase.invoice_total, purchase.currency)}</div></div><div className="rounded-xl border bg-white p-4"><div className="text-xs text-slate-500">المدفوع</div><div className="mt-1 text-xl font-black text-emerald-700">{money(purchase.paid_amount, purchase.currency)}</div></div><div className="rounded-xl border bg-white p-4"><div className="text-xs text-slate-500">المتبقي</div><div className="mt-1 text-xl font-black text-amber-700">{money(purchase.remaining, purchase.currency)}</div></div></section>
    <section className="grid gap-2 rounded-xl border bg-white p-4 sm:grid-cols-3 lg:grid-cols-6">{[["الإجمالي قبل الخصم", purchase.subtotal], ["الخصم", purchase.discount_total], ["بعد الخصم", purchase.after_discount], ["الضريبة", purchase.vat_total], ["الشحن", purchase.shipping_cost], ["تكاليف أخرى", purchase.other_costs]].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 font-bold">{money(value, purchase.currency)}</div></div>)}</section>
    {purchase.notes && <section className="rounded-xl border bg-white p-4"><div className="mb-1 font-bold">ملاحظات</div><p className="text-sm text-slate-600">{purchase.notes}</p></section>}
    <section className="flex flex-wrap gap-2 rounded-xl border bg-white p-4">
      {related.project_id && <Button asChild variant="outline"><Link to={`/projects/${related.project_id}/purchases`}><FolderKanban className="h-4 w-4" /> مركز المشروع</Link></Button>}
      {related.source_request_id && <Button asChild variant="outline"><Link to="/incoming-requests" state={{ request_id: related.source_request_id }}><FileText className="h-4 w-4" /> الطلب {related.source_request_number}</Link></Button>}
      {related.comparison_id && <Button asChild variant="outline"><Link to="/supplier-price-comparison" state={{ comparison_id: related.comparison_id }}><Scale className="h-4 w-4" /> المقارنة {related.comparison_number}</Link></Button>}
      {related.approval_id && <Button asChild variant="outline"><Link to="/approvals" state={{ approval_id: related.approval_id }}><FileCheck2 className="h-4 w-4" /> الاعتماد {related.approval_number}</Link></Button>}
      {related.purchase_order_id && <Button asChild variant="outline"><Link to="/purchase-orders" state={{ purchase_order_id: related.purchase_order_id }}><ShoppingCart className="h-4 w-4" /> أمر الشراء</Link></Button>}
    </section>
  </div>;
}
