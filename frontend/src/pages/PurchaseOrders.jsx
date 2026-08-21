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
import { usePreferences } from "@/contexts/PreferencesContext";
import {
  PO_RECEIVING_STATUS_LABEL, PO_STATUS_LABEL, poReceivingStatus,
} from "@/lib/purchaseOrderStatus";

const PO_TONE = {
  draft: "neutral", pending: "warning", approved: "info", sent: "info",
  confirmed: "info", in_delivery: "info", partial_received: "warning",
  delivery_problem: "danger", completed: "success", cancelled: "danger",
};
const PAYMENT_TONE = { paid: "success", partially_paid: "warning", unpaid: "neutral", due: "neutral", not_due: "neutral" };
const RECEIVING_TONE = { awaiting_delivery: "neutral", in_delivery: "info", partially_received: "warning", delivery_problem: "danger", fully_received: "success" };

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const { tr, locale } = usePreferences();
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
      && (!paymentStatusFilter || (order.payment_summary?.payment_status === "paid" ? "paid" : order.payment_summary?.payment_status === "partially_paid" ? "partially_paid" : "unpaid") === paymentStatusFilter)
      && (!receivingStatusFilter || poReceivingStatus(order.status) === receivingStatusFilter)
      && (!query || [order.po_number, order.project_name, order.supplier_name].some((value) => String(value || "").toLocaleLowerCase("ar").includes(query)));
  }), [orders, projectFilter, supplierFilter, statusFilter, paymentStatusFilter, receivingStatusFilter, search]);

  const clearFilters = () => { setProjectFilter(""); setSupplierFilter(""); setStatusFilter(""); setPaymentStatusFilter(""); setReceivingStatusFilter(""); setSearch(""); };
  const deleteOrder = async (order) => {
    if (!["draft", "cancelled"].includes(order.status)) return toast.error(tr("الحذف متاح للمسودة أو أمر الشراء الملغي فقط", "Only draft or cancelled purchase orders can be deleted"));
    if (!window.confirm(tr(`هل تريد حذف أمر الشراء ${order.po_number}؟`, `Delete purchase order ${order.po_number}?`))) return;
    try { await api.delete(`/purchase-orders/${order.id}`); setOrders((current) => current.filter((item) => item.id !== order.id)); toast.success(tr("تم حذف أمر الشراء", "Purchase order deleted")); }
    catch (error) { toast.error(errMsg(error)); }
  };

  const columns = [
    { key: "po_number", label: tr("رقم PO", "PO number"), render: (order) => <button type="button" className="font-mono font-bold text-primary hover:underline" dir="ltr" onClick={() => navigate(`/purchase-orders/${order.id}`)}>{order.po_number}</button> },
    { key: "project_name", label: tr("المشروع", "Project"), className: "max-w-44 truncate" },
    { key: "supplier_name", label: tr("المورد", "Supplier"), className: "max-w-44 truncate" },
    { key: "final_total", label: tr("الإجمالي", "Total"), className: "text-end", render: (order) => <span className="font-semibold tabular-nums" dir="ltr">{fmtEGP(order.final_total)}</span> },
    { key: "payment", label: tr("حالة السداد", "Payment status"), render: (order) => { const value = order.payment_summary?.payment_status; return <StatusBadge tone={PAYMENT_TONE[value]}>{value === "paid" ? tr("مدفوع بالكامل", "Paid in full") : value === "partially_paid" ? tr("مدفوع جزئيًا", "Partially paid") : tr("غير مدفوع", "Unpaid")}</StatusBadge>; } },
    { key: "receiving", label: tr("حالة الاستلام", "Receiving status"), render: (order) => { const value = poReceivingStatus(order.status); const en = { not_started: "Not started", in_delivery: "In delivery", partially_received: "Partial receipt", delivery_problem: "Receiving problem", fully_received: "Completed" }[value]; return <StatusBadge tone={RECEIVING_TONE[value]}>{tr(PO_RECEIVING_STATUS_LABEL[value], en)}</StatusBadge>; } },
    { key: "status", label: tr("حالة PO", "PO status"), render: (order) => <StatusBadge tone={PO_TONE[order.status]}>{tr(PO_STATUS_LABEL[order.status] || order.status, { draft: "Draft", approved: "Approved", sent: "Sent", supplier_confirmed: "Supplier confirmed", in_delivery: "In delivery", partial_received: "Partial receipt", delivery_problem: "Delivery problem", completed: "Completed", cancelled: "Cancelled" }[order.status] || order.status)}</StatusBadge> },
    { key: "updated_at", label: tr("آخر تحديث", "Updated"), className: "whitespace-nowrap", render: (order) => order.updated_at ? new Date(order.updated_at).toLocaleDateString(locale) : order.po_date || "-" },
    { key: "actions", label: "", className: "w-28", render: (order) => <div className="flex items-center justify-end gap-1"><Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => navigate(`/purchase-orders/${order.id}`)} data-testid={`open-po-${order.id}`}><Eye className="h-4 w-4" />{tr("فتح", "Open")}</Button><ActionMenu label={tr("إجراءات", "Actions")} actions={[{ label: tr("فتح التفاصيل", "Open details"), icon: <Eye />, onSelect: () => navigate(`/purchase-orders/${order.id}`) }, { label: tr("حذف", "Delete"), icon: <Trash2 />, destructive: true, disabled: !["draft", "cancelled"].includes(order.status), onSelect: () => deleteOrder(order) }]} /></div> },
  ];

  return (
    <div className="space-y-5" data-testid="purchase-orders-page">
      <PageHeader title={tr("أوامر الشراء", "Purchase Orders")} description={tr("سجل تشغيلي مختصر؛ التتبع والمستندات والتاريخ داخل تفاصيل الأمر.", "A concise operational register; traceability, documents, and history live in PO details.")} />
      <FilterBar resultLabel={tr(`${filteredOrders.length} من ${orders.length} أمر شراء`, `${filteredOrders.length} of ${orders.length} purchase orders`)} onClear={clearFilters} data-testid="purchase-order-filters">
        <SearchInput className="w-full sm:w-72" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tr("رقم PO أو المشروع أو المورد...", "PO number, project, or supplier...")} data-testid="purchase-order-search" />
        <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="">{tr("كل المشاريع", "All projects")}</option>{projects.map((value) => <option key={value}>{value}</option>)}</select>
        <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="">{tr("كل الموردين", "All suppliers")}</option>{suppliers.map((value) => <option key={value}>{value}</option>)}</select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm" data-testid="purchase-order-status-filter"><option value="">{tr("كل حالات PO", "All PO statuses")}</option>{Object.entries(PO_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{tr(label, { draft: "Draft", approved: "Approved", sent: "Sent", supplier_confirmed: "Supplier confirmed", in_delivery: "In delivery", partial_received: "Partial receipt", delivery_problem: "Delivery problem", completed: "Completed", cancelled: "Cancelled" }[value])}</option>)}</select>
        <select value={paymentStatusFilter} onChange={(event) => setPaymentStatusFilter(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm" data-testid="purchase-order-payment-filter"><option value="">{tr("كل حالات السداد", "All payment statuses")}</option><option value="unpaid">{tr("غير مدفوع", "Unpaid")}</option><option value="partially_paid">{tr("مدفوع جزئيًا", "Partially paid")}</option><option value="paid">{tr("مدفوع بالكامل", "Paid in full")}</option></select>
        <select value={receivingStatusFilter} onChange={(event) => setReceivingStatusFilter(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm" data-testid="purchase-order-receiving-filter"><option value="">{tr("كل حالات الاستلام", "All receiving statuses")}</option>{Object.entries(PO_RECEIVING_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{tr(label, { not_started: "Not started", in_delivery: "In delivery", partially_received: "Partial receipt", delivery_problem: "Receiving problem", fully_received: "Completed" }[value])}</option>)}</select>
      </FilterBar>
      {loading ? <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">{tr("جارٍ تحميل أوامر الشراء...", "Loading purchase orders...")}</div> : <DataTable columns={columns} rows={filteredOrders} rowTestId="purchase-order-row" tableClassName="min-w-[1040px]" empty={<EmptyState title={tr("لا توجد أوامر شراء", "No purchase orders")} description={tr("أنشئ أمر الشراء من مقارنة أسعار معتمدة؛ سيظهر هنا تلقائيًا.", "Create a PO from an approved comparison; it will appear here automatically.")} />} />}
    </div>
  );
}
