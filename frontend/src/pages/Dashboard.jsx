import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle, CircleDollarSign, ClipboardCheck, FileCheck2,
  Inbox, PackageCheck, ShoppingCart, Truck, Wallet,
} from "lucide-react";

import {
  EmptyState, KpiStrip, Panel, PageHeader, StatusBadge,
} from "@/components/procurement-ui";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { usePreferences } from "@/contexts/PreferencesContext";
import api, { fmtEGP } from "@/lib/api";

export const ATTENTION_META = {
  delivery_problem: { label: ["مشكلة توريد", "Delivery problem"], tone: "danger", action: ["مراجعة التوريد", "Review delivery"] },
  needs_clarification: { label: ["يحتاج توضيح", "Needs clarification"], tone: "warning", action: ["فتح الطلب", "Open request"] },
  request_review: { label: ["مراجعة فنية", "Technical review"], tone: "info", action: ["مراجعة الطلب", "Review request"] },
  overdue_payment: { label: ["دفعة معلقة", "Outstanding payment"], tone: "warning", action: ["مراجعة الدفعات", "Review payments"] },
  rfq_past_deadline: { label: ["عرض سعر ناقص", "Missing quotation"], tone: "warning", action: ["متابعة RFQ", "Follow up RFQ"] },
  quotation_missing: { label: ["عرض مورد ناقص", "Supplier response missing"], tone: "warning", action: ["متابعة RFQ", "Follow up RFQ"] },
  sourcing_required: { label: ["بدء التسعير", "Sourcing required"], tone: "primary", action: ["فتح الطلب", "Open request"] },
  pending_approval: { label: ["اعتماد مطلوب", "Approval required"], tone: "primary", action: ["فتح الاعتماد", "Open approval"] },
  awaiting_supplier_confirmation: { label: ["تأكيد المورد", "Supplier confirmation"], tone: "info", action: ["فتح أمر الشراء", "Open purchase order"] },
  partial_received: { label: ["استلام جزئي", "Partial receipt"], tone: "warning", action: ["متابعة الاستلام", "Review receiving"] },
};

export const ATTENTION_REASONS = {
  delivery_problem: ["مشكلة في التوريد تحتاج معالجة", "A delivery issue requires action"],
  needs_clarification: ["بانتظار استكمال التوضيح المطلوب", "Waiting for the requested clarification"],
  request_review: ["طلب شراء يحتاج مراجعة فنية", "Purchase request requires technical review"],
  overdue_payment: ["يوجد رصيد مستحق للمورد", "A supplier balance remains outstanding"],
  rfq_past_deadline: ["انتهت مهلة الرد على طلب التسعير", "The RFQ response deadline has passed"],
  quotation_missing: ["لم تكتمل ردود الموردين", "Supplier responses are incomplete"],
  sourcing_required: ["أصناف معتمدة جاهزة لإنشاء طلب تسعير ومقارنة", "Approved items are ready for RFQ and comparison"],
  pending_approval: ["قرار اعتماد مطلوب", "An approval decision is required"],
  awaiting_supplier_confirmation: ["أمر الشراء ينتظر تأكيد المورد", "The PO is awaiting supplier confirmation"],
  partial_received: ["استلام جزئي يحتاج متابعة", "A partial receipt requires follow-up"],
};

const PIPELINE_LABELS = {
  new: ["طلبات جديدة", "New requests"], technical_review: ["المراجعة الفنية", "Technical review"],
  pricing_rfq: ["التسعير وطلبات العروض", "Pricing & RFQs"], waiting_approval: ["بانتظار الاعتماد", "Awaiting approval"],
  po_procurement: ["جاهز لأمر الشراء", "Ready for PO"], under_delivery: ["تحت التوريد", "Under delivery"],
  completed: ["مكتمل", "Completed"], closed: ["مغلق", "Closed"], other: ["أخرى", "Other"],
};

const QUICK_ACTIONS = [
  [Inbox, ["الطلبات الواردة", "Incoming requests"], "/incoming-requests"],
  [FileCheck2, ["الاعتمادات", "Approvals"], "/approvals"],
  [ShoppingCart, ["أوامر الشراء", "Purchase orders"], "/purchase-orders"],
  [Wallet, ["الدفعات", "Payments"], "/payments"],
];

const HIGH_PRIORITY_ATTENTION = new Set([
  "delivery_problem", "overdue_payment", "rfq_past_deadline", "pending_approval",
]);

const ROLE_LABELS = {
  admin: ["الإدارة", "Administration"],
  procurement_engineer: ["مهندس المشتريات", "Procurement engineer"],
  procurement_responsible: ["مسؤول المشتريات", "Procurement"],
  commercial_manager: ["المدير التجاري", "Commercial manager"],
  general_manager: ["المدير العام", "General manager"],
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { tr } = usePreferences();
  const [dashboard, setDashboard] = useState(null);

  useEffect(() => {
    api.get("/dashboard").then((response) => setDashboard(response.data));
  }, []);

  const supplierByReference = useMemo(() => {
    if (!dashboard) return {};
    const rows = [
      ...(dashboard.payment_intelligence?.attention || []),
      ...(dashboard.receiving?.attention || []),
    ];
    return Object.fromEntries(rows.map((row) => [row.po_number, row.supplier_name || ""]));
  }, [dashboard]);

  if (!dashboard) {
    return <div className="py-16 text-center text-sm text-muted-foreground">{tr("جارٍ تجهيز لوحة العمل...", "Preparing your workspace...")}</div>;
  }

  const summary = dashboard.summary || {};
  const attentionItems = dashboard.attention_items || [];
  const pipeline = dashboard.request_pipeline || [];
  const approvals = dashboard.approval_attention?.stages || [];
  const pendingApprovals = approvals.reduce((total, row) => total + Number(row.count || 0), 0);
  const projects = dashboard.project_procurement_summary || [];
  const receiving = dashboard.receiving || {};
  const maxPipelineCount = Math.max(...pipeline.map((item) => Number(item.count || 0)), 1);
  const receivingIssues = Number(receiving.delivery_problem_count || 0)
    + Number(receiving.partial_received_count || 0);

  return (
    <div className="space-y-3" data-testid="dashboard-page">
      <PageHeader
        title={tr("ما يحتاج انتباهك اليوم", "What needs your attention today")}
        description={tr("ملخص تشغيلي للمسار الرسمي فقط؛ افتح السجل المطلوب مباشرة.", "An operational view of the formal procurement workflow with direct next actions.")}
        actions={QUICK_ACTIONS.map(([Icon, labels, path]) => (
          <Button key={path} type="button" variant="outline" size="sm" onClick={() => navigate(path)} className="gap-1.5 bg-card">
            <Icon className="h-4 w-4 text-primary" />{tr(...labels)}
          </Button>
        ))}
      />

      <section data-testid="formal-procurement-kpis">
        <KpiStrip
          items={[
            { icon: AlertCircle, label: tr("يحتاج إجراء", "Needs action"), value: attentionItems.length, tone: attentionItems.length ? "danger" : "neutral", testId: "kpi-action-required" },
            { icon: ShoppingCart, label: tr("أوامر شراء نشطة", "Active purchase orders"), value: summary.active_purchase_orders ?? 0, tone: "info", testId: "kpi-active-pos" },
            { icon: CircleDollarSign, label: tr("المتبقي للموردين", "Outstanding to suppliers"), value: fmtEGP(summary.outstanding), tone: "warning", testId: "kpi-outstanding" },
            { icon: Truck, label: tr("مشكلات التوريد والاستلام", "Delivery / receiving issues"), value: receivingIssues, tone: receivingIssues ? "danger" : "neutral", testId: "kpi-receiving-issues" },
            { icon: ClipboardCheck, label: tr("قرارات اعتماد معلقة", "Pending approval decisions"), value: pendingApprovals, tone: pendingApprovals ? "warning" : "neutral", testId: "kpi-pending-approvals" },
          ]}
        />
      </section>

      <Panel
        testId="attention-center"
        title={tr("يحتاج متابعتي", "Needs my attention")}
        description={tr("مرتّب حسب أولوية المتابعة الفعلية.", "Prioritized by operational urgency.")}
        action={<span className="border bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">{tr(`${attentionItems.length} سجلات`, `${attentionItems.length} records`)}</span>}
        bodyClassName="p-0"
      >
        {attentionItems.length ? (
          <Table>
            <TableHeader>
              <TableRow className="h-8 bg-muted/70 hover:bg-muted/70">
                <TableHead className="h-8 w-20 text-[10px] uppercase tracking-wide">{tr("الأولوية", "Priority")}</TableHead>
                <TableHead className="h-8 text-[10px] uppercase tracking-wide">{tr("المرجع", "Reference")}</TableHead>
                <TableHead className="h-8 text-[10px] uppercase tracking-wide">{tr("المشكلة / النوع", "Type / issue")}</TableHead>
                <TableHead className="h-8 text-[10px] uppercase tracking-wide">{tr("المشروع", "Project")}</TableHead>
                <TableHead className="h-8 text-[10px] uppercase tracking-wide">{tr("العمر / التاريخ", "Age / date")}</TableHead>
                <TableHead className="h-8 text-[10px] uppercase tracking-wide">{tr("المسؤول", "Responsible")}</TableHead>
                <TableHead className="h-8 w-28 text-end text-[10px] uppercase tracking-wide">{tr("الإجراء التالي", "Next action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attentionItems.slice(0, 10).map((item, index) => {
                const meta = ATTENTION_META[item.type] || { label: [item.type, item.type], tone: "neutral", action: ["فتح", "Open"] };
                const reasonText = ATTENTION_REASONS[item.type] ? tr(...ATTENTION_REASONS[item.type]) : item.reason;
                const isHighPriority = HIGH_PRIORITY_ATTENTION.has(item.type);
                const roleLabel = ROLE_LABELS[item.responsible_role];
                return (
                  <TableRow key={`${item.type}-${item.reference}-${index}`} className="h-9" data-testid={`attention-item-${item.type}`}>
                    <TableCell className="whitespace-nowrap py-1"><StatusBadge tone={isHighPriority ? "danger" : "warning"}>{isHighPriority ? tr("عاجل", "High") : tr("متابعة", "Follow up")}</StatusBadge></TableCell>
                    <TableCell className="whitespace-nowrap py-1 font-mono text-xs font-bold text-foreground" dir="ltr">{item.reference}</TableCell>
                    <TableCell className="max-w-[250px] py-1 text-xs">
                      <div className="flex items-center gap-1.5"><StatusBadge tone={meta.tone}>{tr(...meta.label)}</StatusBadge><span className="truncate text-muted-foreground" title={reasonText}>{reasonText}</span></div>
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate py-1 text-xs text-muted-foreground" title={item.project_name}>
                      {item.project_name || tr("بدون مشروع", "No project")}
                      {supplierByReference[item.reference] && <span> · {supplierByReference[item.reference]}</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-1 text-xs text-muted-foreground" dir="auto">{item.due_or_age || "-"}</TableCell>
                    <TableCell className="max-w-[120px] truncate py-1 text-xs text-muted-foreground" title={item.responsible_role}>{roleLabel ? tr(...roleLabel) : (item.responsible_role || "-")}</TableCell>
                    <TableCell className="w-28 py-1 text-end">
                      <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => navigate(item.path)}>{tr(...meta.action)}</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <EmptyState compact icon={ClipboardCheck} title={tr("لا توجد إجراءات عاجلة حاليًا", "Nothing needs action right now")} description={tr("ستظهر هنا السجلات التي تحتاج قرارًا أو متابعة.", "Records requiring a decision or follow-up will appear here.")} />
        )}
      </Panel>

      <div className="grid gap-3 xl:grid-cols-[1fr_1.35fr]">
        <Panel testId="request-pipeline" title={tr("الحركة الحالية", "Active workflow")} description={tr("توزيع الطلبات عبر مراحل العمل.", "Requests currently moving through the workflow.")}>
          <div className="space-y-2">
            {pipeline.filter((row) => row.count > 0).map((row) => (
              <div key={row.key}><div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="text-muted-foreground">{PIPELINE_LABELS[row.key] ? tr(...PIPELINE_LABELS[row.key]) : row.label}</span><b className="tabular-nums text-foreground">{row.count}</b></div><div className="h-1 overflow-hidden bg-muted"><div className="h-full bg-primary/70" style={{ width: `${Math.max(8, Number(row.count || 0) / maxPipelineCount * 100)}%` }} /></div></div>
            ))}
            {!pipeline.some((row) => row.count > 0) && <EmptyState compact title={tr("لا توجد طلبات نشطة", "No active requests")} description={tr("ستظهر مراحل الطلبات هنا عند بدء دورة مشتريات جديدة.", "Workflow stages will appear when a new procurement cycle starts.")} />}
          </div>
        </Panel>

        <Panel testId="chart-project-value" title={tr("التعرض المالي حسب المشروع", "Project financial exposure")} description={tr("الالتزام والمدفوع والمتبقي من أوامر الشراء الرسمية.", "Committed, paid, and outstanding formal PO value.")} bodyClassName="p-0">
          {projects.length ? (
            <Table>
              <TableHeader><TableRow className="h-8 bg-muted/70 hover:bg-muted/70"><TableHead className="h-8 text-[10px] uppercase tracking-wide">{tr("المشروع", "Project")}</TableHead><TableHead className="h-8 text-end text-[10px] uppercase tracking-wide">{tr("قيمة PO", "PO value")}</TableHead><TableHead className="h-8 text-end text-[10px] uppercase tracking-wide">{tr("المدفوع", "Paid")}</TableHead><TableHead className="h-8 text-end text-[10px] uppercase tracking-wide">{tr("المتبقي", "Outstanding")}</TableHead></TableRow></TableHeader>
              <TableBody>{projects.slice(0, 6).map((row) => <TableRow key={row.project_id || row.project_name} className="h-8"><TableCell className="max-w-[180px] truncate py-1 text-xs font-semibold" title={row.project_name}>{row.project_name}</TableCell><TableCell className="whitespace-nowrap py-1 text-end text-xs tabular-nums" dir="ltr">{fmtEGP(row.formal_po_value)}</TableCell><TableCell className="whitespace-nowrap py-1 text-end text-xs tabular-nums text-emerald-700 dark:text-emerald-300" dir="ltr">{fmtEGP(row.actual_paid)}</TableCell><TableCell className="whitespace-nowrap py-1 text-end text-xs font-bold tabular-nums text-amber-700 dark:text-amber-300" dir="ltr">{fmtEGP(row.outstanding)}</TableCell></TableRow>)}</TableBody>
            </Table>
          ) : <EmptyState compact title={tr("لا توجد قيم مشاريع", "No project values yet")} description={tr("تظهر المقارنة بعد إصدار أول أمر شراء رسمي.", "This view appears after the first formal PO is issued.")} />}
        </Panel>
      </div>

      <Panel testId="po-status-section" title={tr("سلامة التوريد والاستلام", "Delivery and receiving health")} description={tr("مؤشرات تشغيلية مختصرة مع إبراز الاستثناءات.", "A concise operational view focused on exceptions.")} bodyClassName="p-0">
        <KpiStrip
          className="border-0"
          items={[
            { icon: Truck, label: tr("قيد التوريد", "In delivery"), value: receiving.in_delivery_count ?? 0, tone: "info" },
            { icon: PackageCheck, label: tr("استلام جزئي", "Partial receipt"), value: receiving.partial_received_count ?? 0, tone: "warning" },
            { icon: AlertCircle, label: tr("مشكلات توريد", "Delivery problems"), value: receiving.delivery_problem_count ?? 0, tone: "danger" },
            { icon: ClipboardCheck, label: tr("مكتمل الاستلام", "Receiving complete"), value: receiving.completed_count ?? 0, tone: "success" },
          ]}
        />
      </Panel>
    </div>
  );
}
