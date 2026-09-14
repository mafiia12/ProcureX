import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Ban, CheckCircle2, FileText, History,
  PackageCheck, Printer, ShieldCheck, Truck, Wallet, XCircle,
} from "lucide-react";
import { toast } from "sonner";

import PurchaseOrderPaymentDrawer from "@/components/PurchaseOrderPaymentDrawer";
import ProcurementProgress from "@/components/ProcurementProgress";
import {
  ActionBar, Callout, EmptyState, KpiStrip, LoadRetryButton, PageHeader, Panel, StatusBadge, Timeline,
} from "@/components/procurement-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { usePreferences } from "@/contexts/PreferencesContext";
import api, { errMsg, fmtEGP } from "@/lib/api";
import { roleAtLeast } from "@/lib/roles";
import {
  PO_CANCELLABLE_STATUSES, PO_NEXT_STATUS, PO_NEXT_STATUS_ACTION_LABEL,
  PO_PAYMENT_METHOD_LABEL, PO_STATUS_LABEL, PO_STATUS_STYLE,
} from "@/lib/purchaseOrderStatus";

const receiptLabels = {
  full: ["تم الاستلام بالكامل", "Received in full"],
  partial: ["استلام جزئي", "Partial receipt"],
  problem: ["مشكلة / غير مطابق", "Receiving problem"],
};
const problemReasons = [
  ["كمية ناقصة", "Short quantity"],
  ["مواصفة غير مطابقة", "Specification mismatch"],
  ["صنف مختلف", "Wrong item"],
  ["تالف", "Damaged"],
  ["مشكلة أخرى", "Other problem"],
];
const paymentMethodEnglish = {
  bank_transfer: "Bank transfer", cash: "Cash", cheque: "Cheque", card: "Card", other: "Other",
};
const makeKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

const DEEP_LINK_TABS = new Set(["payments", "receiving"]);

export default function PurchaseOrderDetails() {
  const { purchaseOrderId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { tr, direction, locale } = usePreferences();
  const role = user?.role || "";
  const canOperatePO = roleAtLeast(role, "procurement_responsible");
  const canManagePayments = roleAtLeast(role, "commercial_manager");
  const requestedSection = searchParams.get("section");
  const [activeTab, setActiveTab] = useState(
    DEEP_LINK_TABS.has(requestedSection) ? requestedSection : "overview",
  );
  const [order, setOrder] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [actor, setActor] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [receiveMode, setReceiveMode] = useState("");
  const [quantities, setQuantities] = useState({});
  const [problemReason, setProblemReason] = useState("");
  const [affectedItemId, setAffectedItemId] = useState("");
  const [affectedQuantity, setAffectedQuantity] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState("");
  const requestKeys = useRef({});
  const submitting = useRef(false);

  const load = async () => {
    setLoadError(false);
    try {
      const { data } = await api.get(`/purchase-orders/${purchaseOrderId}`);
      setOrder(data);
    } catch (error) {
      if (error?.response?.status === 404) {
        toast.error(tr("تعذر فتح السجل المطلوب أو تغيرت حالته", "Couldn't open that record, or its status has changed"));
        navigate("/purchase-orders", { replace: true });
        return;
      }
      setLoadError(true);
      toast.error(errMsg(error));
    }
  };
  const loadLedger = async () => {
    try {
      const { data } = await api.get(`/purchase-orders/${purchaseOrderId}/payments`);
      setLedger(data);
    } catch (error) {
      toast.error(errMsg(error));
    }
  };
  useEffect(() => { load(); loadLedger(); }, [purchaseOrderId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (DEEP_LINK_TABS.has(requestedSection)) setActiveTab(requestedSection);
  }, [purchaseOrderId, requestedSection]);

  const finalize = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/purchase-orders/${purchaseOrderId}/finalize`, { actor, note });
      setOrder(data.purchase_order);
      toast.success(tr("تم تنفيذ أمر الشراء وأصبح قيد التوريد", "Purchase order issued and moved to delivery"));
    } catch (error) { toast.error(errMsg(error)); }
    finally { setBusy(false); }
  };

  const patchStatus = async (status) => {
    setBusy(true);
    try {
      await api.patch(`/purchase-orders/${purchaseOrderId}/status`, { status });
      await load();
      toast.success(status === "cancelled"
        ? tr("تم إلغاء أمر الشراء", "Purchase order cancelled")
        : tr("تم تحديث حالة أمر الشراء", "Purchase order status updated"));
    } catch (error) { toast.error(errMsg(error)); }
    finally { setBusy(false); }
  };

  const requestAdvance = () => {
    const targetStatus = PO_NEXT_STATUS[order.status];
    if (!targetStatus) return;
    setPendingAction({
      type: "advance",
      targetStatus,
      label: tr(
        PO_NEXT_STATUS_ACTION_LABEL[targetStatus],
        { approved: "Approve purchase order", sent: "Record supplier dispatch", supplier_confirmed: "Confirm supplier acceptance" }[targetStatus],
      ),
    });
  };
  const requestFinalize = () => setPendingAction({ type: "finalize", label: tr("تنفيذ أمر الشراء وبدء التوريد", "Issue PO and start delivery") });
  const requestCancel = () => setPendingAction({ type: "cancel", targetStatus: "cancelled", label: tr("إلغاء أمر الشراء", "Cancel purchase order") });
  const requestFullReceipt = () => setPendingAction({ type: "receive_full", label: tr("استلام كامل الكميات المتبقية", "Receive all remaining quantities") });

  const receive = async (receiptType) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    const key = requestKeys.current[receiptType] || makeKey();
    requestKeys.current[receiptType] = key;
    try {
      const lines = receiptType === "partial" ? order.items
        .map((item) => ({ purchase_order_item_id: item.id, quantity: Number(quantities[item.id] || 0) }))
        .filter((line) => line.quantity > 0) : [];
      const { data } = await api.post(`/purchase-orders/${purchaseOrderId}/receipts`, {
        receipt_type: receiptType,
        idempotency_key: key,
        actor,
        note,
        lines,
        problem_reason: receiptType === "problem" ? problemReason : "",
        affected_item_id: receiptType === "problem" ? affectedItemId : "",
        affected_quantity: receiptType === "problem" ? Number(affectedQuantity || 0) : 0,
      });
      requestKeys.current[receiptType] = "";
      setOrder(data.purchase_order);
      setReceiveMode("");
      setQuantities({});
      setProblemReason("");
      setAffectedItemId("");
      setAffectedQuantity("");
      setNote("");
      toast.success(data.purchase_order.status === "completed"
        ? tr("تم استلام كل الكميات وإغلاق أمر الشراء", "All quantities received; purchase order completed")
        : tr("تم حفظ استلام الموقع", "Site receipt recorded"));
    } catch (error) { toast.error(errMsg(error)); }
    finally { submitting.current = false; setBusy(false); }
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    if (pendingAction.type === "finalize") await finalize();
    else if (pendingAction.type === "receive_full") await receive("full");
    else await patchStatus(pendingAction.targetStatus);
    setPendingAction(null);
  };

  const confirmVoid = async () => {
    if (!voidTarget || !voidReason.trim()) return;
    setBusy(true);
    try {
      await api.post(`/purchase-orders/${purchaseOrderId}/payments/${voidTarget.id}/void`, { reason: voidReason.trim() });
      await loadLedger();
      toast.success(tr("تم إلغاء الدفعة", "Payment voided"));
      setVoidTarget(null);
    } catch (error) { toast.error(errMsg(error)); }
    finally { setBusy(false); }
  };

  if (!order) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        {loadError ? (
          <LoadRetryButton
            onRetry={load}
            testId="po-load-retry-button"
            label={tr("تعذر تحميل أمر الشراء — إعادة المحاولة", "Could not load the purchase order — retry")}
          />
        ) : (
          <span role="status">{tr("جارٍ تحميل أمر الشراء...", "Loading purchase order...")}</span>
        )}
      </div>
    );
  }

  const receivingOpen = ["in_delivery", "partial_received", "delivery_problem"].includes(order.status);
  const completed = order.status === "completed";
  const reportsAvailable = receivingOpen || completed;
  const canFinalize = ["draft", "approved", "sent", "supplier_confirmed"].includes(order.status);
  const receiptSummary = order.receipt_summary || { ordered_quantity: 0, received_quantity: 0, remaining_quantity: 0 };
  const currentStage = completed ? 9 : receivingOpen ? 8 : 6;
  const paymentSummary = ledger?.payment_summary || {
    po_total: order.final_total,
    paid_amount: 0,
    outstanding_amount: order.final_total,
    payment_status: "unpaid",
  };
  const partialHasAnyQuantity = order.items.some((item) => Number(quantities[item.id] || 0) > 0);
  const partialHasInvalidQuantity = order.items.some((item) => (
    Number(quantities[item.id] || 0) > Number(item.remaining_quantity ?? item.quantity) + 1e-9
  ));
  const statusLabel = tr(PO_STATUS_LABEL[order.status] || order.status, {
    draft: "Draft", approved: "Approved", sent: "Sent to supplier",
    supplier_confirmed: "Supplier confirmed", in_delivery: "In delivery",
    partial_received: "Partial receipt", delivery_problem: "Delivery problem",
    completed: "Completed", cancelled: "Cancelled",
  }[order.status] || order.status);
  const paymentStatusLabel = {
    paid: tr("مدفوع بالكامل", "Paid in full"),
    partially_paid: tr("مدفوع جزئيًا", "Partially paid"),
    due: tr("مستحق السداد", "Payment due"),
    not_due: tr("غير مدفوع", "Unpaid"),
    unpaid: tr("غير مدفوع", "Unpaid"),
  }[paymentSummary.payment_status] || paymentSummary.payment_status;
  const receivingStatus = completed
    ? tr("مكتمل", "Completed")
    : order.status === "partial_received"
      ? tr("استلام جزئي", "Partial receipt")
      : order.status === "delivery_problem"
        ? tr("مشكلة استلام", "Receiving problem")
        : receivingOpen ? tr("قيد التوريد", "In delivery") : tr("لم يبدأ", "Not started");

  const number = (value) => Number(value || 0).toLocaleString(locale, { maximumFractionDigits: 6 });
  const pct = (value) => `${Number(value || 0).toLocaleString(locale)}%`;

  return <div className="space-y-4" data-testid="purchase-order-details-page">
    <PageHeader
      eyebrow={tr("أمر شراء رسمي", "Formal purchase order")}
      title={<span className="flex flex-wrap items-center gap-2">{order.po_number} <StatusBadge className={PO_STATUS_STYLE[order.status]}>{statusLabel}</StatusBadge></span>}
      description={tr("تابع الإجراء الحالي والدفعات والاستلام من مساحة عمل واحدة.", "Track the current action, payments, and receiving from one workspace.")}
      actions={<Button variant="outline" size="sm" onClick={() => navigate("/purchase-orders")}>{direction === "rtl" ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}{tr("العودة للسجل", "Back to register")}</Button>}
    />

    <section className="rounded-lg border bg-card p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div><div className="text-xs text-muted-foreground">{tr("المورد", "Supplier")}</div><div className="mt-1 font-bold">{order.supplier_name || "-"}</div></div>
        <div><div className="text-xs text-muted-foreground">{tr("المشروع", "Project")}</div><div className="mt-1 font-bold">{order.project_name || "-"}</div></div>
        <div><div className="text-xs text-muted-foreground">{tr("حالة أمر الشراء", "PO status")}</div><div className="mt-1 font-bold">{statusLabel}</div></div>
      </div>
    </section>

    <KpiStrip
      items={[
        { label: tr("إجمالي أمر الشراء", "PO total"), value: fmtEGP(paymentSummary.po_total ?? order.final_total), icon: Wallet, tone: "primary" },
        { label: tr("المدفوع", "Paid"), value: fmtEGP(paymentSummary.paid_amount), icon: CheckCircle2, tone: "success" },
        { label: tr("المتبقي", "Outstanding"), value: fmtEGP(paymentSummary.outstanding_amount), icon: AlertTriangle, tone: "warning" },
        { label: tr("حالة الاستلام", "Receiving status"), value: receivingStatus, icon: PackageCheck, tone: order.status === "delivery_problem" ? "danger" : completed ? "success" : "neutral" },
      ]}
    />

    {canFinalize && <ActionBar data-testid="po-operational-actions">
      <div className="me-auto min-w-52">
        <div className="text-xs font-semibold text-muted-foreground">{tr("الإجراء التشغيلي التالي", "Next operational action")}</div>
        <div className="text-sm font-bold">{statusLabel}</div>
      </div>
      {canOperatePO ? <>
        <Input className="h-9 w-48" value={actor} onChange={(event) => setActor(event.target.value)} placeholder={tr("اسم مسؤول المشتريات", "Procurement officer")} />
        <Input className="h-9 w-48" value={note} onChange={(event) => setNote(event.target.value)} placeholder={tr("ملاحظة اختيارية", "Optional note")} />
        {PO_NEXT_STATUS[order.status] && <Button size="sm" variant="outline" disabled={busy} onClick={requestAdvance} data-testid="po-advance-status-button"><CheckCircle2 className="h-4 w-4" />{tr(PO_NEXT_STATUS_ACTION_LABEL[PO_NEXT_STATUS[order.status]], { approved: "Approve purchase order", sent: "Record supplier dispatch", supplier_confirmed: "Confirm supplier acceptance" }[PO_NEXT_STATUS[order.status]])}</Button>}
        <Button size="sm" disabled={busy || !order.workflow?.funds_released} onClick={requestFinalize} data-testid="po-finalize-button"><ShieldCheck className="h-4 w-4" />{tr("تأكيد وإصدار أمر الشراء للتنفيذ", "Issue purchase order")}</Button>
        {PO_CANCELLABLE_STATUSES.has(order.status) && <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={requestCancel} data-testid="po-cancel-button"><XCircle className="h-4 w-4" />{tr("إلغاء أمر الشراء", "Cancel PO")}</Button>}
      </> : <div className="text-sm text-amber-800 dark:text-amber-300">{tr("الإجراء متاح لمسؤول المشتريات فقط؛ باقي الأدوار يمكنها العرض.", "Only the procurement lead can perform this action; other roles have read access.")}</div>}
    </ActionBar>}

    <Tabs value={activeTab} onValueChange={setActiveTab} dir={direction}>
      <TabsList className="flex h-auto w-full justify-start overflow-x-auto">
        {[
          ["overview", tr("نظرة عامة", "Overview")],
          ["items", tr("البنود", "Items")],
          ["payments", tr("الدفعات", "Payments")],
          ["receiving", tr("الاستلام", "Receiving")],
          ["documents", tr("المستندات", "Documents")],
          ["history", tr("التتبع والسجل", "Traceability & history")],
        ].map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}
      </TabsList>

      <TabsContent value="overview" forceMount className="data-[state=inactive]:hidden">
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <Panel title={tr("بيانات أمر الشراء", "Purchase order overview")}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                [tr("العميل", "Client"), order.customer_name],
                [tr("تاريخ PO", "PO date"), order.po_date],
                [tr("شروط الدفع", "Payment terms"), order.payment_terms],
                [tr("مدة التوريد", "Lead time"), order.delivery_days ? tr(`${order.delivery_days} يوم`, `${order.delivery_days} days`) : "-"],
                [tr("اعتماد الصرف", "Expenditure approval"), order.workflow?.expenditure_approved ? tr("معتمد", "Approved") : tr("بانتظار", "Pending")],
                [tr("إتاحة المبلغ", "Funds availability"), order.workflow?.funds_released ? tr("🟢 متاح", "Available") : tr("غير متاح", "Unavailable")],
              ].map(([label, value]) => <div key={label}><div className="text-xs text-muted-foreground">{label}</div><div className="mt-0.5 font-semibold">{value || "-"}</div></div>)}
            </div>
            {order.notes && <div className="mt-4 rounded-md bg-muted/50 p-3 text-sm"><b>{tr("ملاحظات", "Notes")}:</b> {order.notes}</div>}
          </Panel>
          <Panel title={tr("الملخص المالي", "Financial summary")}>
            <div className="space-y-2 text-sm">
              {[
                [tr("قبل الخصم", "Subtotal"), order.subtotal],
                [tr("الخصم", "Discount"), order.discount_total],
                [tr("الضريبة", "VAT"), order.vat_total],
                [tr("الشحن", "Shipping"), order.shipping_total],
                [tr("تكاليف أخرى", "Other costs"), order.other_total],
                [tr("الإجمالي النهائي", "Final total"), order.final_total],
              ].map(([label, value], index) => <div key={label} className={`flex items-center justify-between gap-3 ${index === 5 ? "border-t pt-2 font-bold" : ""}`}><span className="text-muted-foreground">{label}</span><span dir="ltr">{fmtEGP(value)}</span></div>)}
            </div>
          </Panel>
        </div>
        <div className="mt-4"><ProcurementProgress currentStage={currentStage} /></div>
      </TabsContent>

      <TabsContent value="items" forceMount className="data-[state=inactive]:hidden">
        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/80 text-muted-foreground"><tr>
                {[tr("الصنف", "Item"), tr("الكمية", "Qty"), tr("الوحدة", "Unit"), tr("سعر الوحدة", "Unit price"), tr("إجمالي البند", "Line total"), tr("المستلم", "Received"), tr("المتبقي", "Remaining")].map((label) => <th key={label} className="h-9 px-3 text-start text-xs font-bold">{label}</th>)}
              </tr></thead>
              <tbody>{order.items.map((item) => <tr key={item.id} className="border-t hover:bg-muted/40" data-testid="po-detail-item">
                <td className="px-3 py-2"><div className="font-semibold">{item.product_name}</div><details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer text-primary">{tr("تفاصيل التسعير والمواصفات", "Pricing and specification details")}</summary><div className="mt-1 max-w-lg">{[item.item_code, item.brand, item.specifications].filter(Boolean).join(" · ") || tr("بدون مواصفات إضافية", "No additional specifications")} · {tr("خصم", "Discount")} {pct(item.discount_pct)} · {tr("ضريبة", "VAT")} {pct(item.vat_pct)} · {tr("شحن", "Shipping")} {fmtEGP(item.shipping_cost)} · {tr("أخرى", "Other")} {fmtEGP(item.other_cost)}</div></details></td>
                <td className="px-3 py-2 tabular-nums">{number(item.quantity)}</td>
                <td className="px-3 py-2">{item.unit}</td>
                <td className="px-3 py-2 tabular-nums" dir="ltr">{fmtEGP(item.unit_price)}</td>
                <td className="px-3 py-2 font-semibold tabular-nums" dir="ltr">{fmtEGP(item.line_total)}</td>
                <td className="px-3 py-2 tabular-nums">{number(item.received_quantity)}</td>
                <td className="px-3 py-2 tabular-nums">{number(item.remaining_quantity ?? item.quantity)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>
      </TabsContent>

      <TabsContent value="payments" forceMount className="data-[state=inactive]:hidden">
        <section className="border bg-card p-3" data-testid="po-payment-summary">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{tr("دفعات أمر الشراء", "Purchase order payments")}</h3><StatusBadge tone={paymentSummary.payment_status === "paid" ? "success" : paymentSummary.payment_status === "partially_paid" ? "warning" : "neutral"}>{paymentStatusLabel}{paymentSummary.is_overdue ? tr(" · متأخر", " · Overdue") : ""}</StatusBadge><span title={tr("سجل رسمي مرتبط بأمر الشراء - لا يشمل مدفوعات الشراء المباشر القديمة", "The formal PO-linked ledger - excludes legacy direct-purchase payments")}><StatusBadge tone="info">{tr("دفعة أمر شراء", "PO payment")}</StatusBadge></span></div>
            {canManagePayments && Number(paymentSummary.outstanding_amount) > 0 && <Button size="sm" onClick={() => setRecordOpen(true)} data-testid="po-record-payment-button"><Wallet className="h-4 w-4" />{tr("تسجيل دفعة", "Record payment")}</Button>}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {[[tr("إجمالي أمر الشراء", "PO total"), paymentSummary.po_total], [tr("المدفوع", "Paid"), paymentSummary.paid_amount], [tr("المتبقي", "Outstanding"), paymentSummary.outstanding_amount]].map(([label, value]) => <div key={label} className="rounded-md bg-muted/50 p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-bold tabular-nums" dir="ltr">{fmtEGP(value)}</div></div>)}
          </div>
          {!!(paymentSummary.credit_days || paymentSummary.payment_terms) && <div className="mt-2 text-xs text-muted-foreground">{paymentSummary.credit_days ? tr(`مدة الائتمان: ${paymentSummary.credit_days} يوم`, `Credit: ${paymentSummary.credit_days} days`) : ""}{paymentSummary.credit_days && paymentSummary.payment_terms ? " · " : ""}{paymentSummary.payment_terms ? `${tr("شروط الدفع", "Payment terms")}: ${paymentSummary.payment_terms}` : ""}</div>}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/80 text-muted-foreground"><tr>
                {[tr("رقم الدفعة", "Payment"), tr("التاريخ", "Date"), tr("القيمة", "Amount"), tr("الطريقة", "Method"), tr("المرجع", "Reference"), tr("الحالة", "Status"), tr("سجلها", "Recorded by"), tr("ملاحظات", "Notes")].map((label) => <th key={label} className="h-9 px-2 text-start text-xs font-bold">{label}</th>)}
                {canManagePayments && <th className="w-16" />}
              </tr></thead>
              <tbody>{!ledger?.payments?.length ? <tr><td colSpan={canManagePayments ? 9 : 8}><EmptyState compact title={tr("لا توجد دفعات مسجلة", "No payments recorded")} description={tr("عند تسجيل دفعة ستظهر هنا.", "Recorded payments will appear here.")} /></td></tr> : ledger.payments.map((payment) => <tr key={payment.id} className={`border-t ${payment.status === "voided" ? "text-muted-foreground line-through" : ""}`} data-testid="po-payment-row">
                <td className="px-2 py-2 font-mono font-bold" dir="ltr">{payment.payment_number}</td>
                <td className="px-2 py-2">{payment.payment_date}</td>
                <td className="px-2 py-2 font-bold" dir="ltr">{fmtEGP(payment.amount)}</td>
                <td className="px-2 py-2">{tr(PO_PAYMENT_METHOD_LABEL[payment.payment_method] || payment.payment_method, paymentMethodEnglish[payment.payment_method] || payment.payment_method)}</td>
                <td className="px-2 py-2">{payment.payment_reference || "-"}</td>
                <td className="px-2 py-2"><StatusBadge tone={payment.status === "voided" ? "danger" : "success"}>{payment.status === "voided" ? tr("ملغاة", "Voided") : tr("مسجلة", "Recorded")}</StatusBadge></td>
                <td className="px-2 py-2">{payment.created_by || "-"}</td>
                <td className="px-2 py-2 text-xs text-muted-foreground">{payment.notes || "-"}</td>
                {canManagePayments && <td>{payment.status === "recorded" && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { setVoidTarget(payment); setVoidReason(""); }} data-testid={`po-void-button-${payment.id}`}><Ban className="h-4 w-4" /></Button>}</td>}
              </tr>)}</tbody>
            </table>
          </div>
        </section>
      </TabsContent>

      <TabsContent value="receiving" forceMount className="data-[state=inactive]:hidden">
        {(receivingOpen || completed) ? <section className="border bg-card p-3" data-testid="site-receiving-section">
          <div className="flex items-center gap-2 font-bold"><PackageCheck className="h-5 w-5 text-primary" />{tr("استلام الموقع", "Site receiving")}</div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[[tr("إجمالي المطلوب", "Ordered"), receiptSummary.ordered_quantity], [tr("إجمالي المستلم", "Received"), receiptSummary.received_quantity], [tr("المتبقي", "Remaining"), receiptSummary.remaining_quantity], [tr("الحالة", "Status"), receivingStatus]].map(([label, value]) => <div key={label} className="rounded-md bg-muted/50 p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-bold">{typeof value === "number" ? number(value) : value}</div></div>)}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">{tr("عدد عمليات الاستلام", "Receipts")}: {receiptSummary.receipt_count ?? 0} · {tr("آخر استلام", "Last receipt")}: {receiptSummary.latest_receipt_date ? new Date(receiptSummary.latest_receipt_date).toLocaleString(locale) : "-"}</div>
          <div className="mt-4 space-y-2">{order.items.map((item) => <div key={item.id} className="rounded-md border p-3"><div className="flex justify-between gap-3 text-sm"><b>{item.product_name}</b><span>{number(item.received_quantity)} / {number(item.quantity)} {item.unit}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, Number(item.quantity) ? Number(item.received_quantity || 0) / Number(item.quantity) * 100 : 0)}%` }} /></div></div>)}</div>
          {receivingOpen && canOperatePO && <>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={requestFullReceipt} data-testid="receive-full"><CheckCircle2 className="h-4 w-4" />{tr("استلمنا الكل", "Receive all")}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setReceiveMode(receiveMode === "partial" ? "" : "partial")} data-testid="receive-partial"><Truck className="h-4 w-4" />{tr("وصل جزء", "Partial receipt")}</Button>
              <Button size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={() => setReceiveMode(receiveMode === "problem" ? "" : "problem")} data-testid="receive-problem"><AlertTriangle className="h-4 w-4" />{tr("تسجيل مشكلة", "Report problem")}</Button>
            </div>
            {receiveMode === "partial" && <div className="mt-4 space-y-3 rounded-lg border bg-muted/30 p-4" data-testid="partial-receipt-form"><h4 className="font-bold">{tr("الكميات المستلمة الآن", "Quantities received now")}</h4>{order.items.map((item) => <div key={item.id} className="grid items-center gap-2 rounded-md bg-card p-3 md:grid-cols-[2fr_repeat(4,1fr)]"><b>{item.product_name}</b><span className="text-xs">{tr("المطلوب", "Ordered")}<br/><b>{number(item.quantity)}</b></span><span className="text-xs">{tr("سابقًا", "Previously")}<br/><b>{number(item.received_quantity)}</b></span><label className="text-xs">{tr("الآن", "Now")}<Input type="number" min="0" max={item.remaining_quantity} step="any" value={quantities[item.id] || ""} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} /></label><span className="text-xs">{tr("المتبقي بعده", "Remaining after")}<br/><b>{number(Math.max(0, Number(item.remaining_quantity || 0) - Number(quantities[item.id] || 0)))}</b></span></div>)}<div className="grid gap-2 md:grid-cols-2"><Input value={actor} onChange={(event) => setActor(event.target.value)} placeholder={tr("اسم المستلم", "Receiver name")} /><Input value={note} onChange={(event) => setNote(event.target.value)} placeholder={tr("ملاحظة اختيارية", "Optional note")} /></div>{partialHasInvalidQuantity && <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive" data-testid="partial-receipt-quantity-error">{tr("لا يمكن أن تتجاوز الكمية المستلمة الآن الكمية المتبقية لأي صنف.", "Received quantity cannot exceed the remaining quantity.")}</div>}<Button className="w-full" disabled={busy || !partialHasAnyQuantity || partialHasInvalidQuantity} onClick={() => receive("partial")}>{tr("حفظ الاستلام الجزئي", "Record partial receipt")}</Button></div>}
            {receiveMode === "problem" && <div className="mt-4 space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4" data-testid="problem-receipt-form"><h4 className="font-bold text-destructive">{tr("تسجيل مشكلة / عدم مطابقة", "Report receiving problem")}</h4><div className="grid gap-2 md:grid-cols-2"><select className="h-10 rounded-md border bg-background px-3" value={problemReason} onChange={(event) => setProblemReason(event.target.value)}><option value="">{tr("اختر السبب...", "Select reason...")}</option>{problemReasons.map(([ar, en]) => <option key={ar} value={ar}>{tr(ar, en)}</option>)}</select><select className="h-10 rounded-md border bg-background px-3" value={affectedItemId} onChange={(event) => setAffectedItemId(event.target.value)}><option value="">{tr("كل الطلب / بدون صنف محدد", "Whole order / no specific item")}</option>{order.items.map((item) => <option key={item.id} value={item.id}>{item.product_name}</option>)}</select><Input type="number" min="0" value={affectedQuantity} onChange={(event) => setAffectedQuantity(event.target.value)} placeholder={tr("الكمية المتأثرة (اختياري)", "Affected quantity (optional)")} /><Input value={actor} onChange={(event) => setActor(event.target.value)} placeholder={tr("اسم مسجل المشكلة", "Reported by")} /><Input className="md:col-span-2" value={note} onChange={(event) => setNote(event.target.value)} placeholder={tr("ملاحظة اختيارية", "Optional note")} /></div><Button className="w-full" variant="destructive" disabled={busy || !problemReason} onClick={() => receive("problem")}>{tr("حفظ المشكلة وإبقاء الطلب مفتوحًا", "Record problem and keep PO open")}</Button></div>}
          </>}
          {receivingOpen && !canOperatePO && <Callout tone="warning" className="mt-4"><span className="text-sm">{tr("تأكيد الاستلام متاح لمسؤول المشتريات؛ باقي الأدوار يمكنها متابعة الحالة.", "Only the procurement lead can record receiving; other roles have read access.")}</span></Callout>}
          {completed && <Callout tone="success" className="mt-4"><span className="text-sm font-semibold">{tr("اكتمل استلام جميع الكميات. لا توجد إجراءات تشغيلية متبقية.", "All quantities received. No operational actions remain.")}</span></Callout>}
        </section> : <EmptyState compact title={tr("لم يبدأ الاستلام", "Receiving has not started")} description={tr("ستظهر إجراءات الاستلام بعد إصدار أمر الشراء وبدء التوريد.", "Receiving actions become available after the PO is issued and delivery starts.")} />}
      </TabsContent>

      <TabsContent value="documents" forceMount className="data-[state=inactive]:hidden">
        <Panel title={tr("المستندات والتقارير", "Documents and reports")}>
          {reportsAvailable ? <div className="flex flex-wrap gap-2"><Button asChild size="sm"><Link to={`/purchase-orders/${order.id}/report/admin`}><Printer className="h-4 w-4" />{tr("تقرير الإدارة بالأسعار", "Management report with prices")}</Link></Button><Button asChild size="sm" variant="outline"><Link to={`/purchase-orders/${order.id}/report/site`}><FileText className="h-4 w-4" />{tr("إشعار الموقع بدون أسعار", "Site notice without prices")}</Link></Button></div> : <EmptyState compact title={tr("لا توجد مستندات تشغيلية بعد", "No operational documents yet")} description={tr("تظهر تقارير التوريد بعد بدء التنفيذ.", "Delivery reports become available after execution begins.")} />}
        </Panel>
      </TabsContent>

      <TabsContent value="history" forceMount className="data-[state=inactive]:hidden">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={tr("تتبع المصدر", "Source traceability")}>
            <div className="flex flex-wrap items-center gap-2 text-sm">{order.source_trace.filter((item) => item.number).map((item, index) => <span key={item.type} className="contents">{index > 0 && <span>{direction === "rtl" ? "←" : "→"}</span>}{item.type === "request" ? <Link className="border bg-blue-500/10 px-2.5 py-1.5 font-bold text-blue-700 dark:text-blue-300" to="/incoming-requests" state={{ request_id: item.id }} dir="ltr">{item.number}</Link> : item.type === "comparison" ? <Link className="border bg-blue-500/10 px-2.5 py-1.5 font-bold text-blue-700 dark:text-blue-300" to="/supplier-price-comparison" state={{ comparison_id: item.id }} dir="ltr">{item.number}</Link> : item.type === "approval" ? <Link className="border bg-blue-500/10 px-2.5 py-1.5 font-bold text-blue-700 dark:text-blue-300" to="/approvals" state={{ approval_id: item.id }} dir="ltr">{item.number}</Link> : <span className="border bg-foreground px-2.5 py-1.5 font-bold text-background" dir="ltr">{item.number}</span>}</span>)}</div>
          </Panel>
          <Panel testId="receipt-history" title={<span className="flex items-center gap-2"><History className="h-4 w-4" />{tr("سجل الاستلام", "Receiving history")}</span>}>
            <Timeline events={order.receipt_history || []} emptyLabel={tr("لا يوجد سجل استلام", "No receiving history")} renderEvent={(receipt) => <div><div className="font-semibold">{tr(...(receiptLabels[receipt.receipt_type] || [receipt.receipt_type, receipt.receipt_type]))}</div>{receipt.problem_reason && <div className="text-sm text-destructive">{tr("السبب", "Reason")}: {receipt.problem_reason}</div>}{!!receipt.lines?.length && <div className="text-sm text-muted-foreground">{receipt.lines.map((line) => `${line.product_name}: ${number(line.received_quantity)} ${line.unit}`).join(" · ")}</div>}{receipt.note && <div className="text-sm text-muted-foreground">{receipt.note}</div>}</div>} />
          </Panel>
        </div>
      </TabsContent>
    </Tabs>

    <Dialog open={!!pendingAction} onOpenChange={(open) => !open && setPendingAction(null)}>
      <DialogContent dir={direction} data-testid="po-action-confirm-dialog">
        <DialogHeader><DialogTitle className="text-start">{tr("تأكيد الإجراء", "Confirm action")}</DialogTitle><DialogDescription className="text-start">{tr("راجع بيانات أمر الشراء قبل التأكيد.", "Review the purchase order before confirming.")}</DialogDescription></DialogHeader>
        {pendingAction && <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3 text-sm">
          <div>{tr("رقم أمر الشراء", "PO number")}<br /><b dir="ltr">{order.po_number}</b></div>
          <div>{tr("المورد", "Supplier")}<br /><b>{order.supplier_name || "-"}</b></div>
          {pendingAction.type === "receive_full" ? <><div>{tr("الكمية المتبقية حاليًا", "Current remaining quantity")}<br /><b>{number(receiptSummary.remaining_quantity)}</b></div><div>{tr("عدد البنود المتبقية", "Remaining line items")}<br /><b>{order.items.filter((item) => Number(item.remaining_quantity ?? item.quantity) > 0).length}</b></div><div className="col-span-2 text-amber-800 dark:text-amber-300">{tr("سيتم استلام جميع الكميات المتبقية لكل البنود دفعة واحدة.", "All remaining quantities will be received in one action.")}</div></> : <><div>{tr("الحالة الحالية", "Current status")}<br /><b>{statusLabel}</b></div><div>{tr("الإجمالي", "Total")}<br /><b dir="ltr">{fmtEGP(order.final_total)}</b></div></>}
          <div className="col-span-2">{tr("الإجراء", "Action")}<br /><b>{pendingAction.label}</b></div>
        </div>}
        <DialogFooter className="gap-2"><Button variant="outline" onClick={() => setPendingAction(null)}>{tr("إلغاء", "Cancel")}</Button><Button data-testid="po-action-confirm-button" variant={pendingAction?.type === "cancel" ? "destructive" : "default"} disabled={busy} onClick={confirmPendingAction}>{tr("تأكيد", "Confirm")} {pendingAction?.label}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <PurchaseOrderPaymentDrawer open={recordOpen} onOpenChange={setRecordOpen} order={order} paymentSummary={paymentSummary} onRecorded={loadLedger} />

    <Dialog open={!!voidTarget} onOpenChange={(open) => !open && setVoidTarget(null)}>
      <DialogContent dir={direction} data-testid="po-void-payment-dialog">
        <DialogHeader><DialogTitle className="text-start">{tr("تأكيد إلغاء الدفعة", "Confirm payment void")}</DialogTitle><DialogDescription className="text-start">{tr("لن تُحذف الدفعة؛ سيتم إلغاؤها ولن تُحتسب ضمن المدفوع.", "The payment will be voided, not deleted, and excluded from paid totals.")}</DialogDescription></DialogHeader>
        {voidTarget && <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3 text-sm"><div>{tr("رقم الدفعة", "Payment number")}<br /><b dir="ltr">{voidTarget.payment_number}</b></div><div>{tr("القيمة", "Amount")}<br /><b dir="ltr">{fmtEGP(voidTarget.amount)}</b></div><div>{tr("التاريخ", "Date")}<br /><b>{voidTarget.payment_date}</b></div><div>{tr("المرجع", "Reference")}<br /><b>{voidTarget.payment_reference || "-"}</b></div></div>}
        <label className="space-y-1"><span className="text-xs text-muted-foreground">{tr("سبب الإلغاء (مطلوب)", "Void reason (required)")}</span><Textarea value={voidReason} onChange={(event) => setVoidReason(event.target.value)} data-testid="po-void-reason-input" /></label>
        <DialogFooter className="gap-2"><Button variant="outline" onClick={() => setVoidTarget(null)}>{tr("تراجع", "Back")}</Button><Button variant="destructive" disabled={busy || !voidReason.trim()} onClick={confirmVoid} data-testid="po-void-confirm-button">{tr("تأكيد الإلغاء", "Confirm void")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
