import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  ActionMenu, DataTable, EmptyState, FilterBar, PageHeader, SearchInput,
  StatusBadge,
} from "@/components/procurement-ui";
import { Button } from "@/components/ui/button";
import api, { errMsg, fmtEGP } from "@/lib/api";
import {
  PO_ACTUAL_PAYMENT_STATUS_LABEL, PO_RECEIVING_STATUS_LABEL,
  PO_STATUS_LABEL, poActualPaymentStatusLabel, poReceivingStatus,
} from "@/lib/purchaseOrderStatus";

const PO_TONE = {
  draft: "neutral", pending: "warning", approved: "info", sent: "info",
  confirmed: "info", in_delivery: "info", partial_received: "warning",
  delivery_problem: "danger", completed: "success", cancelled: "danger",
};
const PAYMENT_TONE = { paid: "success", partially_paid: "warning", due: "neutral", not_due: "neutral" };
const RECEIVING_TONE = { awaiting_delivery: "neutral", in_delivery: "info", partially_received: "warning", delivery_problem: "danger", fully_received: "success" };

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [projectFilter, setProjectFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("");
  const [receivingStatusFilter, setReceivingStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get("/purchase-orders"); setOrders(data || []); }
    catch (error) { toast.error(errMsg(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadOrders(); }, [loadOrders]);

  const projects = useMemo(() => [...new Set(orders.map((order) => order.project_name).filter(Boolean))].sort(), [orders]);
  const suppliers = useMemo(() => [...new Set(orders.map((order) => order.supplier_name).filter(Boolean))].sort(), [orders]);
  const filteredOrders = useMemo(() => orders.filter((order) => {
    const query = search.trim().toLocaleLowerCase("ar");
    return (!projectFilter || order.project_name === projectFilter)
      && (!supplierFilter || order.supplier_name === supplierFilter)
      && (!statusFilter || order.status === statusFilter)
      && (!paymentStatusFilter || order.payment_summary?.payment_status === paymentStatusFilter)
      && (!receivingStatusFilter || poReceivingStatus(order.status) === receivingStatusFilter)
      && (!query || [order.po_number, order.project_name, order.supplier_name].some((value) => String(value || "").toLocaleLowerCase("ar").includes(query)));
  }), [orders, projectFilter, supplierFilter, statusFilter, paymentStatusFilter, receivingStatusFilter, search]);

  const clearFilters = () => { setProjectFilter(""); setSupplierFilter(""); setStatusFilter(""); setPaymentStatusFilter(""); setReceivingStatusFilter(""); setSearch(""); };
  const deleteOrder = async (order) => {
    if (!["draft", "cancelled"].includes(order.status)) return toast.error("الحذف متاح للمسودة أو أمر الشراء الملغي فقط");
    if (!window.confirm(`هل تريد حذف أمر الشراء ${order.po_number}؟`)) return;
    try { await api.delete(`/purchase-orders/${order.id}`); setOrders((current) => current.filter((item) => item.id !== order.id)); toast.success("تم حذف أمر الشراء"); }
    catch (error) { toast.error(errMsg(error)); }
  };

  const columns = [
    { key: "po_number", label: "رقم PO", render: (order) => <button type="button" className="font-mono font-bold text-primary hover:underline" dir="ltr" onClick={() => navigate(`/purchase-orders/${order.id}`)}>{order.po_number}</button> },
    { key: "project_name", label: "المشروع", className: "max-w-44 truncate" },
    { key: "supplier_name", label: "المورد", className: "max-w-44 truncate" },
    { key: "final_total", label: "الإجمالي", className: "text-end", render: (order) => <span className="font-semibold tabular-nums">{fmtEGP(order.final_total)}</span> },
    { key: "payment", label: "حالة السداد", render: (order) => <StatusBadge tone={PAYMENT_TONE[order.payment_summary?.payment_status]}>{poActualPaymentStatusLabel(order.payment_summary)}</StatusBadge> },
    { key: "receiving", label: "حالة الاستلام", render: (order) => { const value = poReceivingStatus(order.status); return <StatusBadge tone={RECEIVING_TONE[value]}>{PO_RECEIVING_STATUS_LABEL[value]}</StatusBadge>; } },
    { key: "status", label: "حالة PO", render: (order) => <StatusBadge tone={PO_TONE[order.status]}>{PO_STATUS_LABEL[order.status] || order.status}</StatusBadge> },
    { key: "updated_at", label: "آخر تحديث", className: "whitespace-nowrap", render: (order) => order.updated_at ? new Date(order.updated_at).toLocaleDateString("ar-EG") : order.po_date || "-" },
    { key: "actions", label: "", className: "w-28", render: (order) => <div className="flex items-center justify-end gap-1"><Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => navigate(`/purchase-orders/${order.id}`)} data-testid={`open-po-${order.id}`}><Eye className="h-4 w-4" />فتح</Button><ActionMenu actions={[{ label: "فتح التفاصيل", icon: <Eye />, onSelect: () => navigate(`/purchase-orders/${order.id}`) }, { label: "حذف", icon: <Trash2 />, destructive: true, disabled: !["draft", "cancelled"].includes(order.status), onSelect: () => deleteOrder(order) }]} /></div> },
  ];

  return (
    <div className="space-y-5" data-testid="purchase-orders-page">
      <PageHeader title="أوامر الشراء" description="سجل تشغيلي مختصر. تفاصيل التتبع REQ ← CMP ← APR والمستندات والتاريخ محفوظة داخل كل أمر شراء." />
      <FilterBar resultLabel={`${filteredOrders.length} من ${orders.length} أمر شراء`} onClear={clearFilters} data-testid="purchase-order-filters">
        <SearchInput className="w-full sm:w-72" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="رقم PO أو المشروع أو المورد..." data-testid="purchase-order-search" />
        <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="h-10 rounded-md border bg-white px-3 text-sm"><option value="">كل المشاريع</option>{projects.map((value) => <option key={value}>{value}</option>)}</select>
        <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} className="h-10 rounded-md border bg-white px-3 text-sm"><option value="">كل الموردين</option>{suppliers.map((value) => <option key={value}>{value}</option>)}</select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-md border bg-white px-3 text-sm" data-testid="purchase-order-status-filter"><option value="">كل حالات PO</option>{Object.entries(PO_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select value={paymentStatusFilter} onChange={(event) => setPaymentStatusFilter(event.target.value)} className="h-10 rounded-md border bg-white px-3 text-sm" data-testid="purchase-order-payment-filter"><option value="">كل حالات السداد</option>{Object.entries(PO_ACTUAL_PAYMENT_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select value={receivingStatusFilter} onChange={(event) => setReceivingStatusFilter(event.target.value)} className="h-10 rounded-md border bg-white px-3 text-sm" data-testid="purchase-order-receiving-filter"><option value="">كل حالات الاستلام</option>{Object.entries(PO_RECEIVING_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      </FilterBar>
      {loading ? <div className="rounded-lg border bg-white p-10 text-center text-sm text-slate-400">جارٍ تحميل أوامر الشراء...</div> : <DataTable columns={columns} rows={filteredOrders} rowTestId="purchase-order-row" tableClassName="min-w-[1080px]" empty={<EmptyState title="لا توجد أوامر شراء" description="أنشئ أمر الشراء من مقارنة أسعار معتمدة؛ سيظهر هنا تلقائيًا مع حالة السداد والاستلام." />} />}
    </div>
  );
}
