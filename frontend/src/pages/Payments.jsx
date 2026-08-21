import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CircleDollarSign, Eye, Plus, Receipt, Wallet } from "lucide-react";
import { toast } from "sonner";

import PurchaseOrderPaymentDrawer from "@/components/PurchaseOrderPaymentDrawer";
import {
  DataTable, EmptyState, FilterBar, KpiCard, PageHeader, SearchInput,
  StatusBadge,
} from "@/components/procurement-ui";
import { Button } from "@/components/ui/button";
import { useOptionalAuth } from "@/contexts/AuthContext";
import { usePreferences } from "@/contexts/PreferencesContext";
import api, { errMsg, fmtEGP } from "@/lib/api";

const normalizedStatus = (value) => value === "paid"
  ? "paid"
  : value === "partially_paid" ? "partially_paid" : "unpaid";

export default function Payments() {
  const navigate = useNavigate();
  const { user } = useOptionalAuth() || {};
  const { tr } = usePreferences();
  const canRecordPayment = ["admin", "commercial_manager"].includes(user?.role);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [paymentOrder, setPaymentOrder] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    return api.get("/purchase-orders").then(({ data }) => setOrders(data || []))
      .catch((error) => toast.error(errMsg(error)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const payableOrders = useMemo(() => orders.filter((order) => order.status !== "cancelled"), [orders]);
  const totals = useMemo(() => payableOrders.reduce((result, order) => {
    const summary = order.payment_summary || {};
    result.total += Number(summary.po_total ?? order.final_total ?? 0);
    result.paid += Number(summary.paid_amount || 0);
    result.outstanding += Number(summary.outstanding_amount || 0);
    return result;
  }, { total: 0, paid: 0, outstanding: 0 }), [payableOrders]);

  const filtered = useMemo(() => payableOrders.filter((order) => {
    const query = search.trim().toLocaleLowerCase();
    const paymentStatus = normalizedStatus(order.payment_summary?.payment_status);
    return (!status || paymentStatus === status)
      && (!query || [order.po_number, order.project_name, order.supplier_name]
        .some((value) => String(value || "").toLocaleLowerCase().includes(query)));
  }), [payableOrders, search, status]);

  const paymentMeta = (value) => ({
    paid: { label: tr("مدفوع بالكامل", "Paid in full"), tone: "success" },
    partially_paid: { label: tr("مدفوع جزئيًا", "Partially paid"), tone: "warning" },
    unpaid: { label: tr("غير مدفوع", "Unpaid"), tone: "neutral" },
  }[normalizedStatus(value)]);

  const columns = [
    { key: "po_number", label: tr("أمر الشراء", "PO"), render: (order) => <button type="button" className="font-mono font-bold text-primary hover:underline" dir="ltr" onClick={() => navigate(`/purchase-orders/${order.id}`)}>{order.po_number}</button> },
    { key: "project_name", label: tr("المشروع", "Project"), className: "max-w-44 truncate" },
    { key: "supplier_name", label: tr("المورد", "Supplier"), className: "max-w-44 truncate" },
    { key: "total", label: tr("إجمالي PO", "PO total"), className: "text-end", render: (order) => <span className="font-semibold tabular-nums" dir="ltr">{fmtEGP(order.payment_summary?.po_total ?? order.final_total)}</span> },
    { key: "paid", label: tr("المدفوع", "Paid"), className: "text-end", render: (order) => <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300" dir="ltr">{fmtEGP(order.payment_summary?.paid_amount)}</span> },
    { key: "outstanding", label: tr("المتبقي", "Outstanding"), className: "text-end", render: (order) => <span className="font-semibold tabular-nums text-amber-700 dark:text-amber-300" dir="ltr">{fmtEGP(order.payment_summary?.outstanding_amount)}</span> },
    { key: "payment_status", label: tr("حالة السداد", "Payment status"), render: (order) => { const meta = paymentMeta(order.payment_summary?.payment_status); return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>; } },
    { key: "last_payment", label: tr("آخر دفعة", "Last payment"), render: (order) => order.payment_summary?.last_payment_date || "-" },
    { key: "actions", label: "", className: "w-32", render: (order) => <div className="flex items-center justify-end gap-1">
      {canRecordPayment && Number(order.payment_summary?.outstanding_amount ?? order.final_total) > 0 && <Button type="button" size="sm" className="h-8 gap-1 px-2" onClick={() => setPaymentOrder(order)} data-testid={`record-payment-${order.id}`}><Plus className="h-3.5 w-3.5" />{tr("دفعة", "Payment")}</Button>}
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8" title={tr("سجل الدفعات", "Payment history")} aria-label={tr("سجل الدفعات", "Payment history")} onClick={() => navigate(`/purchase-orders/${order.id}`)} data-testid={`open-po-payments-${order.id}`}><Eye className="h-4 w-4" /></Button>
    </div> },
  ];

  return (
    <div className="space-y-4" data-testid="payments-page">
      <PageHeader
        title={tr("سجل دفعات أوامر الشراء", "Purchase Order Payment Register")}
        description={tr("متابعة الالتزامات والمدفوعات الفعلية من دفتر أوامر الشراء الرسمي.", "Track commitments and actual payments from the formal purchase-order ledger.")}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard icon={Receipt} label={tr("قيمة أوامر الشراء", "Purchase order value")} value={fmtEGP(totals.total)} tone="primary" testId="payments-total-po" />
        <KpiCard icon={Wallet} label={tr("المدفوع فعليًا", "Actually paid")} value={fmtEGP(totals.paid)} tone="success" testId="payments-total-paid" />
        <KpiCard icon={CircleDollarSign} label={tr("المتبقي للموردين", "Outstanding to suppliers")} value={fmtEGP(totals.outstanding)} tone="warning" testId="payments-total-outstanding" />
      </div>

      <FilterBar resultLabel={tr(`${filtered.length} من ${payableOrders.length} أمر شراء`, `${filtered.length} of ${payableOrders.length} purchase orders`)} onClear={() => { setSearch(""); setStatus(""); }}>
        <SearchInput className="w-full sm:w-80" placeholder={tr("بحث برقم PO أو المشروع أو المورد...", "Search by PO, project, or supplier...")} value={search} onChange={(event) => setSearch(event.target.value)} data-testid="payments-search-input" />
        <select className="h-10 min-w-44 rounded-md border bg-background px-3 text-sm text-foreground" value={status} onChange={(event) => setStatus(event.target.value)} data-testid="payments-status-filter">
          <option value="">{tr("كل حالات السداد", "All payment statuses")}</option>
          <option value="unpaid">{tr("غير مدفوع", "Unpaid")}</option>
          <option value="partially_paid">{tr("مدفوع جزئيًا", "Partially paid")}</option>
          <option value="paid">{tr("مدفوع بالكامل", "Paid in full")}</option>
        </select>
      </FilterBar>

      {loading ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">{tr("جارٍ تحميل سجل الدفعات...", "Loading payment register...")}</div>
      ) : (
        <DataTable columns={columns} rows={filtered} rowTestId="payment-row" empty={<EmptyState title={tr("لا توجد أوامر شراء في سجل الدفعات", "No purchase orders in the payment register")} description={tr("ستظهر أوامر الشراء الرسمية هنا فور إنشائها.", "Formal purchase orders will appear here as soon as they are created.")} />} />
      )}

      <PurchaseOrderPaymentDrawer
        open={!!paymentOrder}
        onOpenChange={(open) => !open && setPaymentOrder(null)}
        order={paymentOrder}
        paymentSummary={paymentOrder?.payment_summary}
        onRecorded={load}
      />
    </div>
  );
}
