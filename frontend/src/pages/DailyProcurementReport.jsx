import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertCircle, ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, ClipboardCheck,
  FileCheck2, Inbox, Lock, PackageCheck, Printer, Receipt, RefreshCw, RotateCcw,
  Scale, ShoppingCart, Wallet,
} from "lucide-react";

import {
  DataTable, EmptyState, KpiStrip, PageHeader, Panel, StatusBadge,
} from "@/components/procurement-ui";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePreferences } from "@/contexts/PreferencesContext";
import { useAuth } from "@/contexts/AuthContext";
import api, { errMsg, fmtEGP } from "@/lib/api";
import { REQUEST_STATUSES } from "@/pages/IncomingPurchaseRequests";
import { ATTENTION_META, ATTENTION_REASONS } from "@/pages/Dashboard";
import { PRIORITY_OPTIONS } from "@/lib/requestValidation";
import { roleAtLeast } from "@/lib/roles";
import {
  PO_ACTUAL_PAYMENT_STATUS_LABEL, PO_PAYMENT_METHOD_LABEL, PO_STATUS_LABEL,
} from "@/lib/purchaseOrderStatus";

const REQUEST_STATUS_LABEL = Object.fromEntries(
  REQUEST_STATUSES.map(([code, ar, en]) => [code, [ar, en]]),
);
const PRIORITY_LABEL = Object.fromEntries(PRIORITY_OPTIONS.map((option) => [option.value, option.label]));
const PRIORITY_TONE = { low: "neutral", normal: "info", high: "warning", urgent: "danger" };
const NEXT_ACTION_BY_STATUS = {
  new: ["مراجعة فنية", "Technical review"],
  under_review: ["استكمال المراجعة الفنية", "Continue technical review"],
  need_clarification: ["بانتظار توضيح مقدّم الطلب", "Awaiting requester clarification"],
  hold: ["مراجعة سبب التعليق", "Review hold reason"],
  pricing: ["بدء التسعير / طلب عروض", "Start sourcing / RFQ"],
  waiting_for_approval: ["بانتظار قرار الاعتماد", "Awaiting approval decision"],
  approved: ["إصدار أمر شراء", "Issue purchase order"],
  converted_to_purchase: ["متابعة أمر الشراء", "Follow up purchase order"],
  rejected: ["-", "-"],
  completed: ["-", "-"],
  cancelled: ["-", "-"],
};
const ITEM_REVIEW_LABEL = {
  pending: ["قيد المراجعة", "Pending"], approved: ["معتمد", "Approved"],
  rejected: ["مرفوض", "Rejected"], need_clarification: ["يحتاج توضيح", "Needs clarification"],
  hold: ["معلّق", "On hold"],
};
const ITEM_REVIEW_TONE = { pending: "neutral", approved: "success", rejected: "danger", need_clarification: "warning", hold: "neutral" };
const PO_STATUS_TONE = {
  draft: "neutral", approved: "info", sent: "info", supplier_confirmed: "info",
  in_delivery: "info", partial_received: "warning", delivery_problem: "danger",
  completed: "success", cancelled: "danger",
};
const PAYMENT_TRI_STATE_LABEL = { paid: "مدفوع بالكامل", partially_paid: "مدفوع جزئيًا", unpaid: "غير مدفوع" };
const PAYMENT_TRI_STATE_TONE = { paid: "success", partially_paid: "warning", unpaid: "danger" };
const RECEIPT_TYPE_LABEL = { full: ["استلام كامل", "Full receipt"], partial: ["استلام جزئي", "Partial receipt"], problem: ["مشكلة في الاستلام", "Delivery problem"] };
const RECEIPT_TYPE_TONE = { full: "success", partial: "warning", problem: "danger" };
const SOURCING_STATUS_LABEL = {
  draft: ["مسودة", "Draft"], received: ["تم الاستلام", "Received"], withdrawn: ["منسحب", "Withdrawn"],
  complete: ["مكتمل", "Complete"], incomplete: ["غير مكتمل", "Incomplete"],
};
const SOURCING_STATUS_TONE = { draft: "neutral", received: "success", withdrawn: "danger", complete: "success", incomplete: "warning" };
const RESPONSIBLE_ROLE_LABEL = {
  procurement_engineer: ["مهندس المشتريات", "Procurement Engineer"],
  procurement_responsible: ["مسؤول المشتريات", "Procurement Lead"],
  commercial_manager: ["المدير التجاري", "Commercial Manager"],
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const shiftDate = (dateStr, deltaDays) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  const next = new Date(y, (m || 1) - 1, d || 1);
  next.setDate(next.getDate() + deltaDays);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
};
const formatDateTime = (value, locale) => (value ? new Date(value).toLocaleString(locale) : "-");
const formatTime = (value, locale) => (value ? new Date(value).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "-");

export default function DailyProcurementReport() {
  const navigate = useNavigate();
  const { tr, locale, direction } = usePreferences();
  const { user } = useAuth();
  const canManage = roleAtLeast(user?.role, "procurement_responsible");

  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notesDraft, setNotesDraft] = useState({ general_notes: "", key_risks: "", follow_up_notes: "" });
  const [savingNotes, setSavingNotes] = useState(false);
  const [closing, setClosing] = useState(false);

  const load = useCallback(async (date) => {
    setLoading(true);
    try {
      const { data } = await api.get("/reports/daily", { params: { date } });
      setReport(data);
      setNotesDraft(data.notes || { general_notes: "", key_risks: "", follow_up_notes: "" });
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(selectedDate); }, [selectedDate, load]);

  const saveNotes = async () => {
    setSavingNotes(true);
    try {
      const { data } = await api.put(`/reports/daily/${selectedDate}/notes`, notesDraft);
      setReport((prev) => (prev ? { ...prev, notes: data.notes } : prev));
      toast.success(tr("تم حفظ ملاحظات اليوم", "Daily notes saved"));
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setSavingNotes(false);
    }
  };

  const closeReport = async () => {
    setClosing(true);
    try {
      await api.post(`/reports/daily/${selectedDate}/close`);
      toast.success(tr("تم إغلاق التقرير اليومي", "Daily report closed"));
      await load(selectedDate);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setClosing(false);
    }
  };

  const reopenReport = async () => {
    setClosing(true);
    try {
      await api.post(`/reports/daily/${selectedDate}/reopen`);
      toast.success(tr("تم إعادة فتح التقرير اليومي", "Daily report reopened"));
      await load(selectedDate);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setClosing(false);
    }
  };

  const sections = report?.sections || {};
  const notesDirty = report && (
    notesDraft.general_notes !== (report.notes?.general_notes || "")
    || notesDraft.key_risks !== (report.notes?.key_risks || "")
    || notesDraft.follow_up_notes !== (report.notes?.follow_up_notes || "")
  );

  const summary = report?.summary || {};
  const kpis = useMemo(() => {
    const s = report?.summary || {};
    return [
      { icon: Inbox, label: tr("طلبات شراء واردة", "REQs received"), value: s.new_requests_count ?? 0, tone: "info" },
      { icon: Scale, label: tr("طلبات عروض / مقارنات نشطة", "RFQs / active comparisons"), value: `${s.rfqs_created_count ?? 0} / ${s.comparisons_active_count ?? 0}`, tone: "neutral" },
      { icon: FileCheck2, label: tr("اعتمادات مكتملة", "Approvals completed"), value: s.approvals_completed_count ?? 0, tone: s.approvals_completed_count ? "success" : "neutral" },
      { icon: ShoppingCart, label: tr("أوامر شراء صادرة", "POs issued"), value: s.purchase_orders_issued_count ?? 0, tone: "primary" },
      { icon: Receipt, label: tr("قيمة أوامر الشراء الصادرة", "PO value issued"), value: fmtEGP(s.purchase_orders_issued_value), tone: "primary" },
      { icon: Wallet, label: tr("مدفوعات اليوم", "Payments today"), value: fmtEGP(s.payments_made_value), helper: tr(`${s.payments_made_count ?? 0} دفعة`, `${s.payments_made_count ?? 0} payment(s)`), tone: "success" },
      { icon: AlertCircle, label: tr("رصيد مستحق للموردين", "Outstanding supplier balance"), value: fmtEGP(s.outstanding_supplier_balance), tone: (s.outstanding_supplier_balance || 0) > 0 ? "warning" : "neutral" },
      { icon: PackageCheck, label: tr("استلامات مسجّلة", "Receipts recorded"), value: s.receipts_recorded_count ?? 0, tone: "info" },
    ];
  }, [report, tr]);

  return (
    <div className="space-y-3" data-testid="daily-report-page">
      <style>{"@media print{.no-print{display:none!important}.print-header{display:block!important}}"}</style>

      <PageHeader
        title={tr("التقرير اليومي للمشتريات", "Daily Procurement Report")}
        description={tr("لقطة تشغيلية ومالية للمشتريات في اليوم المحدد.", "An operational and financial snapshot of procurement for the selected date.")}
        eyebrow={report?.report_number}
        actions={(
          <div className="no-print flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={() => setSelectedDate((d) => shiftDate(d, direction === "rtl" ? 1 : -1))}>
              {direction === "rtl" ? <ArrowRight className="h-3.5 w-3.5" /> : <ArrowLeft className="h-3.5 w-3.5" />}
            </Button>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="date"
                value={selectedDate}
                max={todayStr()}
                onChange={(event) => event.target.value && setSelectedDate(event.target.value)}
                className="h-8 border bg-background ps-7 pe-2 text-xs font-semibold"
                data-testid="daily-report-date-input"
              />
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={() => setSelectedDate((d) => shiftDate(d, direction === "rtl" ? -1 : 1))} disabled={selectedDate >= todayStr()}>
              {direction === "rtl" ? <ArrowLeft className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
            </Button>
            {selectedDate !== todayStr() && (
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setSelectedDate(todayStr())}>{tr("اليوم", "Today")}</Button>
            )}
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => load(selectedDate)} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />{tr("تحديث", "Refresh")}
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" />{tr("طباعة", "Print")}
            </Button>
          </div>
        )}
      />

      <div className="print-header hidden">
        <div className="text-center text-lg font-black">RE DECOR &amp; MORE — {tr("التقرير اليومي للمشتريات", "Daily Procurement Report")}</div>
        <div className="mt-1 text-center text-sm">{tr("تاريخ التقرير", "Report date")}: {selectedDate} · {tr("رقم التقرير", "Report No.")}: {report?.report_number}</div>
        <div className="text-center text-xs text-muted-foreground">{tr("تاريخ الإنشاء", "Generated at")}: {formatDateTime(report?.generated_at, locale)}</div>
      </div>

      {report?.is_closed && (
        <div className="no-print flex items-center justify-between gap-3 border border-s-2 border-s-primary bg-card p-2.5 text-xs">
          <span className="flex items-center gap-1.5 font-bold text-foreground"><Lock className="h-3.5 w-3.5 text-primary" />{tr("هذا التقرير مغلق", "This report is closed")} — {tr("الإجماليات مجمّدة وقت الإغلاق", "totals are frozen as of close time")} ({formatDateTime(report.closed_at, locale)} · {report.closed_by})</span>
          {canManage && <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5" onClick={reopenReport} disabled={closing}><RotateCcw className="h-3.5 w-3.5" />{tr("إعادة فتح", "Reopen")}</Button>}
        </div>
      )}

      {loading && !report ? (
        <div className="py-16 text-center text-sm text-muted-foreground">{tr("جارٍ تجهيز التقرير...", "Preparing the report...")}</div>
      ) : (
        <>
          <KpiStrip items={kpis} />

          <Panel testId="section-requests" title={tr("1. طلبات الشراء الواردة", "1. Purchase requests received")} description={tr("طلبات الشراء جت منين؟", "Where did today's purchase requests come from?")}>
            <DataTable
              rowKey="id"
              columns={[
                { key: "request_number", label: tr("رقم الطلب", "REQ #"), render: (row) => <span className="font-mono text-xs" dir="ltr">{row.request_number}</span> },
                { key: "project_name", label: tr("المشروع", "Project") },
                { key: "requester_name", label: tr("مقدّم الطلب", "Requester") },
                { key: "location", label: tr("الموقع", "Location"), className: "max-w-[160px] truncate" },
                { key: "created_at", label: tr("وقت الاستلام", "Received at"), render: (row) => <span dir="ltr" className="text-xs">{formatTime(row.created_at, locale)}</span> },
                { key: "required_delivery_date", label: tr("تاريخ التوريد المطلوب", "Required delivery") },
                { key: "items", label: tr("الأصناف", "Items"), render: (row) => (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-bold">{row.item_count}</span>
                    {Object.entries(row.item_status_breakdown || {}).map(([status, count]) => (
                      <StatusBadge key={status} tone={ITEM_REVIEW_TONE[status] || "neutral"}>{count} {tr(...(ITEM_REVIEW_LABEL[status] || [status, status]))}</StatusBadge>
                    ))}
                  </div>
                ) },
                { key: "priority", label: tr("الأولوية", "Priority"), render: (row) => <StatusBadge tone={PRIORITY_TONE[row.priority] || "neutral"}>{PRIORITY_LABEL[row.priority] || row.priority}</StatusBadge> },
                { key: "status", label: tr("الحالة", "Status"), render: (row) => <StatusBadge tone="neutral">{tr(...(REQUEST_STATUS_LABEL[row.status] || [row.status, row.status]))}</StatusBadge> },
                { key: "next_action", label: tr("الإجراء التالي", "Next action"), render: (row) => tr(...(NEXT_ACTION_BY_STATUS[row.status] || ["-", "-"])) },
              ]}
              rows={sections.requests_received || []}
              empty={<EmptyState compact title={tr("لا توجد طلبات شراء واردة في هذا التاريخ", "No purchase requests received on this date")} />}
            />
          </Panel>

          <Panel testId="section-sourcing" title={tr("2. نشاط التسعير والموردين", "2. Supplier / sourcing activity")} description={tr("طلبات عروض ومقارنات تحركت اليوم.", "RFQs and comparisons active on this date.")}>
            <DataTable
              rowKey={(row) => `${row.kind}-${row.reference}-${row.supplier_name}`}
              columns={[
                { key: "kind", label: tr("النوع", "Type"), render: (row) => <StatusBadge tone="neutral">{row.kind === "comparison" ? tr("مقارنة", "CMP") : tr("عرض مورد", "RFQ")}</StatusBadge> },
                { key: "reference", label: tr("الرقم المرجعي", "Reference"), render: (row) => <span className="font-mono text-xs" dir="ltr">{row.reference || "-"}</span> },
                { key: "project_name", label: tr("المشروع", "Project") },
                { key: "supplier_name", label: tr("المورد", "Supplier") },
                { key: "status", label: tr("حالة العرض", "Offer status"), render: (row) => <StatusBadge tone={SOURCING_STATUS_TONE[row.status] || "neutral"}>{tr(...(SOURCING_STATUS_LABEL[row.status] || [row.status, row.status]))}</StatusBadge> },
                { key: "offer_total", label: tr("إجمالي العرض", "Offer total"), render: (row) => <span dir="ltr">{fmtEGP(row.offer_total)}</span> },
                { key: "is_complete", label: tr("الاكتمال", "Complete"), render: (row) => <StatusBadge tone={row.is_complete ? "success" : "warning"}>{row.is_complete ? tr("مكتمل", "Complete") : tr("غير مكتمل", "Incomplete")}</StatusBadge> },
                { key: "selected", label: tr("تم الاختيار", "Selected"), render: (row) => (row.selected ? <StatusBadge tone="success">{tr("نعم", "Yes")}</StatusBadge> : <StatusBadge tone="neutral">{tr("لا", "No")}</StatusBadge>) },
                { key: "attachment_count", label: tr("المرفقات", "Attachments"), render: (row) => (row.attachment_count === null ? "-" : row.attachment_count) },
                { key: "activity_at", label: tr("وقت النشاط", "Activity time"), render: (row) => <span dir="ltr" className="text-xs">{formatDateTime(row.activity_at, locale)}</span> },
              ]}
              rows={sections.sourcing_activity || []}
              empty={<EmptyState compact title={tr("لا يوجد نشاط تسعير في هذا التاريخ", "No sourcing activity on this date")} />}
            />
          </Panel>

          <Panel testId="section-pos" title={tr("3. أوامر الشراء الصادرة", "3. Purchase orders issued")} description={tr("اتجابت من انهي مورد؟", "Which supplier was each order placed with?")}>
            <DataTable
              rowKey="id"
              columns={[
                { key: "po_number", label: tr("رقم أمر الشراء", "PO #"), render: (row) => <span className="font-mono text-xs" dir="ltr">{row.po_number}</span> },
                { key: "project_name", label: tr("المشروع", "Project") },
                { key: "supplier_name", label: tr("المورد", "Supplier") },
                { key: "source", label: tr("المصدر", "Source"), render: (row) => <span className="text-xs text-muted-foreground">{[row.source_request_number, row.comparison_number, row.approval_number].filter(Boolean).join(" · ") || "-"}</span> },
                { key: "item_count", label: tr("عدد الأصناف", "Items") },
                { key: "final_total", label: tr("الإجمالي", "Total"), render: (row) => <span dir="ltr" className="font-bold">{fmtEGP(row.final_total)}</span> },
                { key: "payment_status", label: tr("حالة السداد", "Payment status"), render: (row) => <StatusBadge tone={PAYMENT_TRI_STATE_TONE[row.payment_status]}>{PAYMENT_TRI_STATE_LABEL[row.payment_status]}</StatusBadge> },
                { key: "status", label: tr("حالة أمر الشراء", "PO status"), render: (row) => <StatusBadge tone={PO_STATUS_TONE[row.status] || "neutral"}>{PO_STATUS_LABEL[row.status] || row.status}</StatusBadge> },
              ]}
              rows={sections.purchase_orders_issued || []}
              empty={<EmptyState compact title={tr("لم تصدر أوامر شراء في هذا التاريخ", "No purchase orders issued on this date")} />}
              rowTestId="daily-report-po-row"
            />
          </Panel>

          <Panel testId="section-supplier-position" title={tr("4. الموقف المالي للموردين", "4. Supplier financial position")} description={tr("مين ليه فلوس باقيه؟ مين اتدفعله حسابه كامل؟", "Who still has an outstanding balance, and who has been paid in full?")}>
            <DataTable
              rowKey={(row) => row.supplier_id || row.supplier_name}
              columns={[
                { key: "supplier_name", label: tr("المورد", "Supplier") },
                { key: "total_po_value", label: tr("إجمالي أوامر الشراء", "Total PO value"), render: (row) => <span dir="ltr">{fmtEGP(row.total_po_value)}</span> },
                { key: "paid_amount", label: tr("المدفوع", "Paid"), render: (row) => <span dir="ltr" className="text-emerald-700 dark:text-emerald-300">{fmtEGP(row.paid_amount)}</span> },
                { key: "outstanding_amount", label: tr("المتبقي", "Outstanding"), render: (row) => <span dir="ltr" className={row.outstanding_amount > 0 ? "font-bold text-destructive" : ""}>{fmtEGP(row.outstanding_amount)}</span> },
                { key: "payment_status", label: tr("حالة السداد", "Payment status"), render: (row) => <StatusBadge tone={PAYMENT_TRI_STATE_TONE[row.payment_status]}>{PAYMENT_TRI_STATE_LABEL[row.payment_status]}</StatusBadge> },
                { key: "open_po_count", label: tr("أوامر مفتوحة", "Open POs") },
                { key: "latest_payment_date", label: tr("آخر دفعة", "Latest payment"), render: (row) => row.latest_payment_date || "-" },
                { key: "latest_po_number", label: tr("آخر أمر شراء", "Latest PO"), render: (row) => <span className="font-mono text-xs" dir="ltr">{row.latest_po_number || "-"}</span> },
              ]}
              rows={sections.supplier_financial_position || []}
              empty={<EmptyState compact title={tr("لا يوجد موقف مالي حتى هذا التاريخ", "No supplier financial position as of this date")} />}
              rowTestId="daily-report-supplier-row"
            />
          </Panel>

          <Panel testId="section-payments" title={tr("5. المدفوعات اليوم", "5. Payments made today")}>
            <DataTable
              rowKey="id"
              columns={[
                { key: "payment_number", label: tr("رقم الدفعة", "Payment #"), render: (row) => <span className="font-mono text-xs" dir="ltr">{row.payment_number}</span> },
                { key: "supplier_name", label: tr("المورد", "Supplier") },
                { key: "po_number", label: tr("أمر الشراء", "PO"), render: (row) => <span className="font-mono text-xs" dir="ltr">{row.po_number}</span> },
                { key: "project_name", label: tr("المشروع", "Project") },
                { key: "amount", label: tr("قيمة الدفعة", "Amount"), render: (row) => <span dir="ltr" className="font-bold">{fmtEGP(row.amount)}</span> },
                { key: "payment_method", label: tr("طريقة الدفع", "Method"), render: (row) => PO_PAYMENT_METHOD_LABEL[row.payment_method] || row.payment_method || "-" },
                { key: "payment_reference", label: tr("المرجع", "Reference"), render: (row) => row.payment_reference || "-" },
                { key: "created_by", label: tr("سجّلها", "Recorded by") },
                { key: "current_outstanding_amount", label: tr("الرصيد المتبقي الحالي*", "Current outstanding*"), render: (row) => <span dir="ltr">{row.current_outstanding_amount === null ? "-" : fmtEGP(row.current_outstanding_amount)}</span> },
              ]}
              rows={sections.payments_today || []}
              empty={<EmptyState compact title={tr("لا توجد مدفوعات مسجلة في هذا التاريخ", "No payments recorded on this date")} />}
            />
            {(sections.payments_today || []).length > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">* {tr("الرصيد المتبقي الحالي وليس لحظة الدفع - لا يُحتفظ بسجل تاريخي لكل دفعة.", "Current balance as of now, not a historical snapshot at payment time - a per-payment running balance is not stored.")}</p>
            )}
          </Panel>

          <Panel testId="section-receiving" title={tr("6. نشاط الاستلام والتوريد", "6. Receiving / delivery activity")}>
            <DataTable
              rowKey="id"
              columns={[
                { key: "po_number", label: tr("أمر الشراء", "PO"), render: (row) => <span className="font-mono text-xs" dir="ltr">{row.po_number}</span> },
                { key: "project_name", label: tr("المشروع", "Project") },
                { key: "supplier_name", label: tr("المورد", "Supplier") },
                { key: "line_count", label: tr("عدد البنود", "Lines") },
                { key: "received_quantity", label: tr("الكمية المستلمة", "Received qty") },
                { key: "receipt_type", label: tr("حالة الاستلام", "Receiving status"), render: (row) => <StatusBadge tone={RECEIPT_TYPE_TONE[row.receipt_type] || "neutral"}>{tr(...(RECEIPT_TYPE_LABEL[row.receipt_type] || [row.receipt_type, row.receipt_type]))}</StatusBadge> },
                { key: "actor_name", label: tr("سجّلها", "Recorded by") },
                { key: "received_at", label: tr("الوقت", "Time"), render: (row) => <span dir="ltr" className="text-xs">{formatTime(row.received_at, locale)}</span> },
              ]}
              rows={sections.receiving_activity || []}
              empty={<EmptyState compact title={tr("لا يوجد نشاط استلام في هذا التاريخ", "No receiving activity on this date")} />}
            />
          </Panel>

          <Panel testId="section-attention" title={tr("7. يحتاج متابعة", "7. Outstanding / needs attention")} description={tr("سجلات تشغيلية فعلية تحتاج قرارًا أو إجراء فقط.", "Only genuinely actionable operational records.")}>
            <DataTable
              rowKey={(row) => `${row.type}-${row.reference}-${row.project_name}-${row.due_or_age}`}
              columns={[
                { key: "type", label: tr("النوع", "Type"), render: (row) => { const meta = ATTENTION_META[row.type] || { label: [row.type, row.type], tone: "neutral" }; return <StatusBadge tone={meta.tone}>{tr(...meta.label)}</StatusBadge>; } },
                { key: "reference", label: tr("المرجع", "Reference"), render: (row) => <span className="font-mono text-xs" dir="ltr">{row.reference}</span> },
                { key: "project_name", label: tr("المشروع", "Project"), render: (row) => row.project_name || "-" },
                { key: "reason", label: tr("السبب", "Reason"), render: (row) => (ATTENTION_REASONS[row.type] ? tr(...ATTENTION_REASONS[row.type]) : row.reason) },
                { key: "due_or_age", label: tr("التاريخ", "Date"), render: (row) => row.due_or_age || "-" },
                { key: "responsible_role", label: tr("الجهة المسؤولة", "Responsible"), render: (row) => (row.responsible_role ? tr(...(RESPONSIBLE_ROLE_LABEL[row.responsible_role] || [row.responsible_role, row.responsible_role])) : "-") },
                { key: "action", label: tr("الإجراء المقترح", "Suggested action"), className: "no-print", render: (row) => { const meta = ATTENTION_META[row.type]; return meta ? <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => navigate(row.path)}>{tr(...meta.action)}</Button> : "-"; } },
              ]}
              rows={sections.needs_attention || []}
              empty={<EmptyState compact icon={ClipboardCheck} title={tr("لا توجد إجراءات عاجلة حاليًا", "Nothing needs action right now")} />}
            />
          </Panel>

          <Panel testId="section-notes" title={tr("8. ملاحظات اليوم", "8. Daily notes")} description={tr("ملاحظات يدوية يسجلها مسؤول المشتريات لمتابعة اليوم.", "Manual notes recorded by the Procurement Lead for the day.")}>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-foreground">{tr("ملاحظات عامة", "General notes")}</label>
                <Textarea rows={4} value={notesDraft.general_notes} disabled={!canManage || report?.is_closed} onChange={(event) => setNotesDraft((prev) => ({ ...prev, general_notes: event.target.value }))} placeholder={tr("مثال: المورد وعد بالتوريد غدًا...", "e.g. supplier promised delivery tomorrow...")} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-foreground">{tr("مخاطر / تأخيرات رئيسية", "Key risks / delays")}</label>
                <Textarea rows={4} value={notesDraft.key_risks} disabled={!canManage || report?.is_closed} onChange={(event) => setNotesDraft((prev) => ({ ...prev, key_risks: event.target.value }))} placeholder={tr("مثال: تأخر الدفع بانتظار اعتماد المالية...", "e.g. payment delayed pending finance approval...")} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-foreground">{tr("متابعة غدًا", "Follow-up tomorrow")}</label>
                <Textarea rows={4} value={notesDraft.follow_up_notes} disabled={!canManage || report?.is_closed} onChange={(event) => setNotesDraft((prev) => ({ ...prev, follow_up_notes: event.target.value }))} placeholder={tr("مثال: شراء عاجل متوقع غدًا...", "e.g. urgent purchase expected tomorrow...")} />
              </div>
            </div>
            {canManage && (
              <div className="no-print mt-3 flex flex-wrap items-center justify-between gap-2">
                <Button type="button" size="sm" onClick={saveNotes} disabled={report?.is_closed || savingNotes || !notesDirty} className="gap-1.5">
                  <CheckCircle2 className="h-4 w-4" />{savingNotes ? tr("جارٍ الحفظ...", "Saving...") : tr("حفظ الملاحظات", "Save notes")}
                </Button>
                {!report?.is_closed && (
                  <Button type="button" size="sm" variant="outline" onClick={closeReport} disabled={closing} className="gap-1.5">
                    <Lock className="h-4 w-4" />{closing ? tr("جارٍ الإغلاق...", "Closing...") : tr("اعتماد / إغلاق التقرير اليومي", "Close daily report")}
                  </Button>
                )}
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
