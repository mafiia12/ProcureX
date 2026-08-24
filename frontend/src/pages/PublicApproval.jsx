import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, CircleDollarSign, Clock3, PenLine, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";

import api, { errMsg, fmtEGP } from "@/lib/api";
import { proofValidationMessage } from "@/lib/approvalWorkflow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const statusText = {
  draft: "قيد التجهيز", ready_to_send: "جاهز للإرسال", sent: "بانتظار فتح الرابط",
  pending_approval: "بانتظار قرارك", approved: "تم الاعتماد", rejected: "تم الرفض",
  revision_requested: "تم طلب تعديل", expired: "انتهت صلاحية الرابط", cancelled: "تم إلغاء الاعتماد",
};

export default function PublicApproval() {
  const { token } = useParams();
  const [approval, setApproval] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState("");
  const [payment, setPayment] = useState(null);
  const [proof, setProof] = useState(null);
  const [reference, setReference] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/public/approvals/${token}`);
      setApproval(data);
      setPayment(data.payments?.[0] || null);
      setError("");
    } catch (requestError) {
      setError(errMsg(requestError));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const decide = async (decision) => {
    setBusy(true);
    try {
      await api.post(`/public/approvals/${token}/decision`, { decision, note });
      toast.success(decision === "approved" ? "تم تسجيل اعتمادك" : decision === "rejected" ? "تم تسجيل الرفض" : "تم إرسال طلب التعديل");
      setNote("");
      await load();
    } catch (requestError) { toast.error(errMsg(requestError)); }
    finally { setBusy(false); }
  };

  const choosePayment = async () => {
    if (!method) return toast.error("اختر طريقة الدفع");
    setBusy(true);
    try {
      const { data } = await api.post(`/public/approvals/${token}/payments`, { method });
      setPayment(data.payment);
      toast.success(method === "cash" ? "تم إنشاء مرجع الدفع النقدي" : "تم حفظ طريقة الدفع");
    } catch (requestError) { toast.error(errMsg(requestError)); }
    finally { setBusy(false); }
  };

  const uploadProof = async () => {
    const validation = proofValidationMessage(proof);
    if (validation) return toast.error(validation);
    const form = new FormData();
    form.append("proof", proof);
    form.append("external_reference", reference);
    setBusy(true);
    try {
      await api.post(`/public/approvals/${token}/payments/${payment.id}/proof`, form);
      toast.success("تم رفع الإثبات للمراجعة — لم يتم تأكيد الدفع بعد");
      await load();
    } catch (requestError) { toast.error(errMsg(requestError)); }
    finally { setBusy(false); }
  };

  if (loading) return <div dir="rtl" className="min-h-screen bg-slate-50 p-8 text-center">جارٍ فتح الاعتماد الآمن...</div>;
  if (error || !approval) return <div dir="rtl" className="min-h-screen bg-slate-50 p-6"><div className="mx-auto mt-16 max-w-md rounded-2xl border bg-white p-8 text-center"><ShieldCheck className="mx-auto h-12 w-12 text-slate-400" /><h1 className="mt-4 text-xl font-bold">تعذر فتح الاعتماد</h1><p className="mt-2 text-slate-600">{error}</p></div></div>;

  const canDecide = ["sent", "pending_approval"].includes(approval.status);
  const paymentUnderReview = ["proof_submitted", "under_review"].includes(payment?.status);

  return (
    <main dir="rtl" className="min-h-screen bg-slate-100 px-3 py-5 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="rounded-2xl bg-slate-900 p-5 text-white shadow-sm">
          <div className="flex items-center justify-between gap-3"><div><div className="text-sm text-slate-300">{approval.company_name}</div><h1 className="mt-1 text-xl font-bold">مراجعة واعتماد عرض الأسعار</h1></div><ShieldCheck className="h-10 w-10 text-emerald-300" /></div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><span className="text-slate-400">الاعتماد</span><div className="font-bold">{approval.approval_number}</div></div><div><span className="text-slate-400">الإصدار</span><div className="font-bold">{Number(approval.revision_number) + 1}</div></div><div><span className="text-slate-400">المشروع</span><div className="font-bold">{approval.project_name || "-"}</div></div><div><span className="text-slate-400">الحالة</span><div className="font-bold">{statusText[approval.status] || approval.status}</div></div></div>
        </header>

        <section className="rounded-2xl border bg-white p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">الأصناف المختارة</h2><span className="text-sm text-slate-500">{approval.lines.length} صنف</span></div>
          <div className="space-y-3">{approval.lines.map((line, index) => <article key={`${line.item_code}-${index}`} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-bold">{line.product_name}</div><div className="mt-1 text-xs text-slate-500">{[line.brand, line.specifications].filter(Boolean).join(" · ")}</div></div><div className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-bold text-blue-800">{line.quantity} {line.unit}</div></div><div className="mt-3 grid grid-cols-3 gap-2 text-sm"><div><span className="text-xs text-slate-500">المورد</span><div className="font-medium">{line.supplier_name}</div></div><div><span className="text-xs text-slate-500">سعر الوحدة</span><div className="font-medium">{fmtEGP(line.unit_price)}</div></div><div><span className="text-xs text-slate-500">الإجمالي</span><div className="font-bold">{fmtEGP(line.line_total)}</div></div></div>{line.notes && <p className="mt-3 rounded-lg bg-slate-50 p-2 text-sm">{line.notes}</p>}</article>)}</div>
          <div className="mt-4 flex items-center justify-between rounded-xl bg-emerald-50 p-4"><span className="font-bold text-emerald-900">الإجمالي النهائي</span><span className="text-xl font-black text-emerald-800">{fmtEGP(approval.final_total)}</span></div>
        </section>

        {canDecide && <section className="rounded-2xl border bg-white p-4"><h2 className="text-center text-lg font-bold">اختر قرارًا واحدًا</h2><p className="mt-1 text-center text-sm text-slate-500">يمكنك كتابة ملاحظة قصيرة عند طلب تعديل أو رفض.</p><Textarea className="mt-4" rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="ملاحظة اختيارية" /><div className="mt-4 grid gap-3 sm:grid-cols-3"><Button disabled={busy} className="h-14 bg-emerald-600 text-base hover:bg-emerald-700" onClick={() => decide("approved")}><CheckCircle2 className="h-5 w-5" /> اعتماد</Button><Button disabled={busy} className="h-14 bg-amber-500 text-base hover:bg-amber-600" onClick={() => decide("revision_requested")}><PenLine className="h-5 w-5" /> طلب تعديل</Button><Button disabled={busy} variant="destructive" className="h-14 text-base" onClick={() => decide("rejected")}><XCircle className="h-5 w-5" /> رفض</Button></div></section>}

        {!canDecide && <section className="rounded-2xl border bg-white p-5 text-center">{approval.status === "approved" ? <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" /> : approval.status === "revision_requested" ? <PenLine className="mx-auto h-12 w-12 text-amber-500" /> : <Clock3 className="mx-auto h-12 w-12 text-slate-400" />}<div className="mt-2 text-lg font-bold">{statusText[approval.status] || approval.status}</div>{approval.decision_note && <p className="mt-2 text-slate-600">{approval.decision_note}</p>}</section>}

        {approval.status === "approved" && <section className="rounded-2xl border bg-white p-4"><div className="flex items-center gap-2"><CircleDollarSign className="h-6 w-6 text-emerald-600" /><h2 className="text-lg font-bold">طريقة الدفع</h2></div>{!payment ? <><div className="mt-4 grid grid-cols-3 gap-2">{[["instapay", "InstaPay"], ["vodafone_cash", "Vodafone Cash"], ["cash", "نقدي"]].map(([value, label]) => <button key={value} type="button" onClick={() => setMethod(value)} className={`min-h-16 rounded-xl border p-2 font-bold ${method === value ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "bg-white"}`}>{label}</button>)}</div><Button disabled={busy || !method} onClick={choosePayment} className="mt-3 h-12 w-full">تأكيد طريقة الدفع</Button></> : <div className="mt-4 rounded-xl bg-slate-50 p-4"><div className="flex justify-between"><span>المبلغ</span><b>{fmtEGP(payment.amount)}</b></div>{payment.method === "cash" ? <div className="mt-4 rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 p-4 text-center"><div className="text-sm">أظهر هذا المرجع للموظف عند الدفع</div><div className="mt-2 font-mono text-2xl font-black tracking-wider">{payment.cash_reference}</div><p className="mt-2 text-xs text-slate-600">لا يؤكد الدفع إلا موظف مخول بعد استلام النقد.</p></div> : <><div className="mt-3 text-sm">حوّل إلى: <b>{approval.payment_accounts[payment.method]}</b></div>{paymentUnderReview ? <div className="mt-4 rounded-lg bg-amber-100 p-3 text-center font-bold text-amber-900">الإثبات تحت المراجعة — الدفع غير مؤكد بعد</div> : payment.status === "verified" ? <div className="mt-4 rounded-lg bg-emerald-100 p-3 text-center font-bold text-emerald-900">تم التحقق من الدفع</div> : <div className="mt-4 space-y-3"><Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="رقم العملية (اختياري)" /><Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setProof(event.target.files?.[0] || null)} /><Button disabled={busy} onClick={uploadProof} className="w-full">رفع صورة التحويل للمراجعة</Button><p className="text-center text-xs text-slate-500">رفع الصورة لا يعني تأكيد الدفع.</p></div>}</>}</div>}</section>}
      </div>
    </main>
  );
}
