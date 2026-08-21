import { useEffect, useMemo, useRef, useState } from "react";
import { CircleDollarSign, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { usePreferences } from "@/contexts/PreferencesContext";
import api, { errMsg, fmtEGP } from "@/lib/api";

const emptyForm = () => ({
  payment_date: new Date().toISOString().slice(0, 10),
  amount: "",
  payment_method: "bank_transfer",
  payment_reference: "",
  notes: "",
});

const methodLabels = {
  bank_transfer: ["تحويل بنكي", "Bank transfer"],
  cash: ["نقدي", "Cash"],
  cheque: ["شيك", "Cheque"],
  card: ["بطاقة", "Card"],
  other: ["أخرى", "Other"],
};

const makeKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

export default function PurchaseOrderPaymentDrawer({
  open,
  onOpenChange,
  order,
  paymentSummary,
  onRecorded,
}) {
  const { tr, direction } = usePreferences();
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const requestKey = useRef("");
  const submitting = useRef(false);

  useEffect(() => {
    if (!open) return;
    requestKey.current = makeKey();
    setForm(emptyForm());
  }, [open, order?.id]);

  const summary = paymentSummary || order?.payment_summary || {};
  const poTotal = Number(summary.po_total ?? order?.final_total ?? 0);
  const paid = Number(summary.paid_amount || 0);
  const outstanding = Number(summary.outstanding_amount ?? Math.max(0, poTotal - paid));
  const amount = Number(form.amount || 0);
  const amountExceedsOutstanding = amount > outstanding + 0.01;
  const projectedOutstanding = Math.max(0, outstanding - amount);
  const canSubmit = form.payment_date && amount > 0 && !amountExceedsOutstanding && !busy;

  const summaryItems = useMemo(() => [
    [tr("رقم أمر الشراء", "PO number"), order?.po_number || "-", true],
    [tr("المورد", "Supplier"), order?.supplier_name || "-"],
    [tr("إجمالي أمر الشراء", "PO total"), fmtEGP(poTotal)],
    [tr("المدفوع", "Paid"), fmtEGP(paid)],
    [tr("المتبقي", "Outstanding"), fmtEGP(outstanding)],
  ], [order?.po_number, order?.supplier_name, outstanding, paid, poTotal, tr]);

  const submit = async () => {
    if (!canSubmit || submitting.current || !order?.id) return;
    submitting.current = true;
    setBusy(true);
    try {
      const { data } = await api.post(`/purchase-orders/${order.id}/payments`, {
        ...form,
        amount,
        idempotency_key: requestKey.current,
      });
      toast.success(tr("تم تسجيل الدفعة", "Payment recorded"));
      onOpenChange(false);
      await onRecorded?.(data);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={direction === "rtl" ? "left" : "right"}
        dir={direction}
        className="w-full overflow-y-auto sm:max-w-lg"
        data-testid="po-record-payment-dialog"
      >
        <SheetHeader className="text-start">
          <SheetTitle>{tr("تسجيل دفعة", "Record payment")}</SheetTitle>
          <SheetDescription>
            {tr("سجّل الدفعة في دفتر أمر الشراء الرسمي.", "Record this payment in the formal purchase-order ledger.")}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
          {summaryItems.map(([label, value, code]) => (
            <div key={label} className={label === tr("المورد", "Supplier") ? "col-span-2" : ""}>
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-0.5 font-semibold" dir={code ? "ltr" : "auto"}>{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">{tr("القيمة *", "Amount *")}</span>
            <Input
              type="number"
              min="0"
              step="any"
              value={form.amount}
              onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
              data-testid="po-payment-amount-input"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">{tr("تاريخ الدفعة *", "Payment date *")}</span>
            <Input
              type="date"
              value={form.payment_date}
              onChange={(event) => setForm((current) => ({ ...current, payment_date: event.target.value }))}
              data-testid="po-payment-date-input"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">{tr("طريقة الدفع", "Payment method")}</span>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
              value={form.payment_method}
              onChange={(event) => setForm((current) => ({ ...current, payment_method: event.target.value }))}
              data-testid="po-payment-method-select"
            >
              {Object.entries(methodLabels).map(([value, labels]) => <option key={value} value={value}>{tr(...labels)}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">{tr("رقم المرجع / التحويل / الشيك", "Reference / transfer / cheque number")}</span>
            <Input
              value={form.payment_reference}
              onChange={(event) => setForm((current) => ({ ...current, payment_reference: event.target.value }))}
              data-testid="po-payment-reference-input"
            />
          </label>
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="font-medium">{tr("ملاحظات", "Notes")}</span>
            <Textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
          </label>
        </div>

        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full gap-2"
          disabled={busy || outstanding <= 0}
          onClick={() => setForm((current) => ({ ...current, amount: outstanding.toFixed(2) }))}
          data-testid="po-payment-full-outstanding-button"
        >
          <CircleDollarSign className="h-4 w-4" />
          {tr("دفع كامل المتبقي", "Pay full outstanding amount")}
        </Button>

        <div className="mt-3 rounded-lg bg-muted/50 p-3 text-sm">
          <span className="text-muted-foreground">{tr("المتبقي المتوقع بعد الدفعة", "Expected outstanding after payment")}</span>
          <div className={`mt-1 font-bold tabular-nums ${amountExceedsOutstanding ? "text-destructive" : "text-emerald-700 dark:text-emerald-300"}`} dir="ltr">
            {fmtEGP(projectedOutstanding)}
          </div>
        </div>
        {amountExceedsOutstanding && (
          <div className="mt-3 rounded-lg bg-destructive/10 p-2 text-sm text-destructive" data-testid="po-payment-amount-error">
            {tr("قيمة الدفعة أكبر من المتبقي على أمر الشراء.", "Payment amount cannot exceed the outstanding balance.")}
          </div>
        )}

        <SheetFooter className="mt-6 gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tr("إلغاء", "Cancel")}
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={submit} data-testid="po-payment-submit-button">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {tr("تأكيد تسجيل الدفعة", "Confirm payment")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
