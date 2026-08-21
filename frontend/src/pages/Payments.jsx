import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CircleDollarSign, Eye, Receipt, Wallet } from "lucide-react";
import { toast } from "sonner";

import {
  DataTable, EmptyState, FilterBar, KpiCard, PageHeader, SearchInput,
  StatusBadge,
} from "@/components/procurement-ui";
import { Button } from "@/components/ui/button";
import api, { errMsg, fmtEGP } from "@/lib/api";

const PAYMENT_STATUS = {
  paid: { label: "مدفوع بالكامل", tone: "success" },
  partially_paid: { label: "مدفوع جزئيًا", tone: "warning" },
  not_due: { label: "غير مدفوع", tone: "neutral" },
  due: { label: "غير مدفوع", tone: "neutral" },
};

const normalizedStatus = (value) => value === "paid"
  ? "paid"
  : value === "partially_paid" ? "partially_paid" : "unpaid";

export default function Payments() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    setLoading(true);
    api.get("/purchase-orders").then(({ data }) => setOrders(data || []))
      .catch((error) => toast.error(errMsg(error)))
      .finally(() => setLoading(false));
  }, []);

  const payableOrders = useMemo(() => orders.filter((order) => order.status !== "cancelled"), [orders]);
  const totals = useMemo(() => payableOrders.reduce((result, order) => {
    const summary = order.payment_summary || {};
    result.total += Number(summary.po_total ?? order.final_total ?? 0);
    result.paid += Number(summary.paid_amount || 0);
    result.outstanding += Number(summary.outstanding_amount || 0);
    return result;
  }, { total: 0, paid: 0, outstanding: 0 }), [payableOrders]);

  const filtered = useMemo(() => payableOrders.filter((order) => {
    const query = search.trim().toLocaleLowerCase("ar");
    const paymentStatus = normalizedStatus(order.payment_summary?.payment_status);
    return (!status || paymentStatus === status)
      && (!query || [order.po_number, order.project_name, order.supplier_name]
        .some((value) => String(value || "").toLocaleLowerCase("ar").includes(query)));
  }), [payableOrders, search, status]);

  const columns = [
    { key: "po_number", label: "أمر الشراء", render: (order) => <button type="button" className="font-mono font-bold text-primary hover:underline" dir="ltr" onClick={() => navigate(`/purchase-orders/${order.id}`)}>{order.po_number}</button> },
    { key: "project_name", label: "المشروع", className: "max-w-48 truncate" },
    { key: "supplier_name", label: "المورد", className: "max-w-48 truncate" },
    { key: "total", label: "إجمالي PO", className: "text-end", render: (order) => <span className="font-semibold tabular-nums">{fmtEGP(order.payment_summary?.po_total ?? order.final_total)}</span> },
    { key: "paid", label: "المدفوع", className: "text-end", render: (order) => <span className="font-semibold tabular-nums text-emerald-700">{fmtEGP(order.payment_summary?.paid_amount)}</span> },
    { key: "outstanding", label: "المتبقي", className: "text-end", render: (order) => <span className="font-semibold tabular-nums text-amber-700">{fmtEGP(order.payment_summary?.outstanding_amount)}</span> },
    { key: "payment_status", label: "حالة السداد", render: (order) => { const meta = PAYMENT_STATUS[order.payment_summary?.payment_status] || PAYMENT_STATUS.not_due; return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>; } },
    { key: "last_payment", label: "آخر دفعة", render: (order) => order.payment_summary?.last_payment_date || "-" },
    { key: "actions", label: "", className: "w-36", render: (order) => <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => navigate(`/purchase-orders/${order.id}`)} data-testid={`open-po-payments-${order.id}`}><Eye className="h-4 w-4" />فتح سجل الدفعات</Button> },
  ];

  return (
    <div className="space-y-5" data-testid="payments-page">
      <PageHeader title="سجل دفعات أوامر الشراء" description="مصدر مالي واحد مبني على دفتر دفعات أوامر الشراء الرسمية؛ تسجيل الدفعات وإلغاؤها يتم من تفاصيل أمر الشراء." />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard icon={Receipt} label="قيمة أوامر الشراء" value={fmtEGP(totals.total)} tone="primary" testId="payments-total-po" />
        <KpiCard icon={Wallet} label="المدفوع فعليًا" value={fmtEGP(totals.paid)} tone="success" testId="payments-total-paid" />
        <KpiCard icon={CircleDollarSign} label="المتبقي للموردين" value={fmtEGP(totals.outstanding)} tone="warning" testId="payments-total-outstanding" />
      </div>

      <FilterBar resultLabel={`${filtered.length} من ${payableOrders.length} أمر شراء`} onClear={() => { setSearch(""); setStatus(""); }}>
        <SearchInput className="w-full sm:w-80" placeholder="بحث برقم PO أو المشروع أو المورد..." value={search} onChange={(event) => setSearch(event.target.value)} data-testid="payments-search-input" />
        <select className="h-10 min-w-44 rounded-md border border-slate-200 bg-white px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value)} data-testid="payments-status-filter">
          <option value="">كل حالات السداد</option>
          <option value="unpaid">غير مدفوع</option>
          <option value="partially_paid">مدفوع جزئيًا</option>
          <option value="paid">مدفوع بالكامل</option>
        </select>
      </FilterBar>

      {loading ? <div className="rounded-lg border bg-white p-10 text-center text-sm text-slate-400">جارٍ تحميل سجل الدفعات...</div> : <DataTable columns={columns} rows={filtered} rowTestId="payment-row" empty={<EmptyState title="لا توجد أوامر شراء في سجل الدفعات" description="ستظهر أوامر الشراء الرسمية هنا فور إنشائها. لا يتم خلط دفعات الشراء المباشر القديمة بهذا السجل." />} />}
    </div>
  );
}
