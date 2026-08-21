import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle, ChevronDown, CircleDollarSign, ClipboardCheck, FileCheck2,
  Inbox, PackageCheck, Receipt, ShoppingCart, Truck, Wallet,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import {
  EmptyState, KpiCard, PageHeader, SectionHeader, StatusBadge,
} from "@/components/procurement-ui";
import { Button } from "@/components/ui/button";
import { usePreferences } from "@/contexts/PreferencesContext";
import api, { fmtEGP } from "@/lib/api";

const ATTENTION_META = {
  delivery_problem: { label: ["مشكلة توريد", "Delivery problem"], tone: "danger", action: ["مراجعة التوريد", "Review delivery"] },
  needs_clarification: { label: ["يحتاج توضيح", "Needs clarification"], tone: "warning", action: ["فتح الطلب", "Open request"] },
  request_review: { label: ["مراجعة فنية", "Technical review"], tone: "info", action: ["مراجعة الطلب", "Review request"] },
  overdue_payment: { label: ["دفعة معلقة", "Outstanding payment"], tone: "warning", action: ["مراجعة الدفعات", "Review payments"] },
  rfq_past_deadline: { label: ["عرض سعر ناقص", "Missing quotation"], tone: "warning", action: ["متابعة RFQ", "Follow up RFQ"] },
  quotation_missing: { label: ["عرض مورد ناقص", "Supplier response missing"], tone: "warning", action: ["متابعة RFQ", "Follow up RFQ"] },
  pending_approval: { label: ["اعتماد مطلوب", "Approval required"], tone: "primary", action: ["فتح الاعتماد", "Open approval"] },
  awaiting_supplier_confirmation: { label: ["تأكيد المورد", "Supplier confirmation"], tone: "info", action: ["فتح أمر الشراء", "Open purchase order"] },
  partial_received: { label: ["استلام جزئي", "Partial receipt"], tone: "warning", action: ["متابعة الاستلام", "Review receiving"] },
};

const ATTENTION_REASONS = {
  delivery_problem: ["مشكلة في التوريد تحتاج معالجة", "A delivery issue requires action"],
  needs_clarification: ["بانتظار استكمال التوضيح المطلوب", "Waiting for the requested clarification"],
  request_review: ["طلب شراء يحتاج مراجعة فنية", "Purchase request requires technical review"],
  overdue_payment: ["يوجد رصيد مستحق للمورد", "A supplier balance remains outstanding"],
  rfq_past_deadline: ["انتهت مهلة الرد على طلب التسعير", "The RFQ response deadline has passed"],
  quotation_missing: ["لم تكتمل ردود الموردين", "Supplier responses are incomplete"],
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

export default function Dashboard() {
  const navigate = useNavigate();
  const { tr } = usePreferences();
  const [dashboard, setDashboard] = useState(null);
  const [showLegacy, setShowLegacy] = useState(false);

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

  return (
    <div className="space-y-5" data-testid="dashboard-page">
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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <KpiCard icon={AlertCircle} label={tr("طلبات تحتاج إجراء", "Requests needing action")} value={summary.requests_requiring_action ?? attentionItems.filter((item) => ["needs_clarification", "request_review"].includes(item.type)).length} tone={(summary.requests_requiring_action ?? 0) ? "danger" : "neutral"} testId="kpi-action-required" />
          <KpiCard icon={ClipboardCheck} label={tr("اعتمادات معلقة", "Pending approvals")} value={pendingApprovals} tone={pendingApprovals ? "warning" : "neutral"} testId="kpi-pending-approvals" />
          <KpiCard icon={ShoppingCart} label={tr("أوامر شراء نشطة", "Active purchase orders")} value={summary.active_purchase_orders ?? 0} tone="info" testId="kpi-active-pos" />
          <KpiCard icon={Receipt} label={tr("قيمة أوامر الشراء", "Purchase order value")} value={fmtEGP(summary.formal_po_value)} tone="primary" testId="kpi-formal-po-value" />
          <KpiCard icon={Wallet} label={tr("المدفوع فعليًا", "Actually paid")} value={fmtEGP(summary.actual_paid)} tone="success" testId="kpi-actual-paid" />
          <KpiCard icon={CircleDollarSign} label={tr("المتبقي للموردين", "Outstanding to suppliers")} value={fmtEGP(summary.outstanding)} tone="warning" testId="kpi-outstanding" />
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4" data-testid="attention-center">
        <SectionHeader
          title={tr("يحتاج متابعتي", "Needs my attention")}
          description={tr("مرتّب حسب أولوية المتابعة الفعلية.", "Prioritized by operational urgency.")}
          action={<span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">{tr(`${attentionItems.length} سجلات`, `${attentionItems.length} records`)}</span>}
        />
        {attentionItems.length ? (
          <div className="divide-y divide-border">
            {attentionItems.slice(0, 10).map((item, index) => {
              const meta = ATTENTION_META[item.type] || { label: [item.type, item.type], tone: "neutral", action: ["فتح", "Open"] };
              return (
                <div key={`${item.type}-${item.reference}-${index}`} className="grid items-center gap-3 py-3 md:grid-cols-[minmax(150px,0.8fr)_minmax(150px,1fr)_minmax(220px,1.6fr)_auto]" data-testid={`attention-item-${item.type}`}>
                  <div className="min-w-0"><div className="font-mono text-sm font-bold text-foreground" dir="ltr">{item.reference}</div><StatusBadge tone={meta.tone}>{tr(...meta.label)}</StatusBadge></div>
                  <div className="min-w-0 text-sm"><div className="truncate font-medium text-foreground">{item.project_name || tr("بدون مشروع", "No project")}</div>{supplierByReference[item.reference] && <div className="truncate text-xs text-muted-foreground">{supplierByReference[item.reference]}</div>}</div>
                  <div className="min-w-0"><div className="text-sm text-foreground">{ATTENTION_REASONS[item.type] ? tr(...ATTENTION_REASONS[item.type]) : item.reason}</div>{item.due_or_age && <div className="mt-0.5 text-xs text-muted-foreground" dir="auto">{item.due_or_age}</div>}</div>
                  <Button type="button" size="sm" variant="outline" onClick={() => navigate(item.path)}>{tr(...meta.action)}</Button>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState compact icon={ClipboardCheck} title={tr("لا توجد إجراءات عاجلة حاليًا", "Nothing needs action right now")} description={tr("ستظهر هنا السجلات التي تحتاج قرارًا أو متابعة.", "Records requiring a decision or follow-up will appear here.")} />
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.35fr]">
        <section className="rounded-lg border bg-card p-4" data-testid="request-pipeline">
          <SectionHeader title={tr("الحركة الحالية", "Active workflow")} description={tr("توزيع الطلبات عبر مراحل العمل.", "Requests currently moving through the workflow.")} />
          <div className="space-y-2.5">
            {pipeline.filter((row) => row.count > 0).map((row) => (
              <div key={row.key}><div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="text-muted-foreground">{PIPELINE_LABELS[row.key] ? tr(...PIPELINE_LABELS[row.key]) : row.label}</span><b className="tabular-nums text-foreground">{row.count}</b></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(8, Number(row.count || 0) / maxPipelineCount * 100)}%` }} /></div></div>
            ))}
            {!pipeline.some((row) => row.count > 0) && <EmptyState compact title={tr("لا توجد طلبات نشطة", "No active requests")} description={tr("ستظهر مراحل الطلبات هنا عند بدء دورة مشتريات جديدة.", "Workflow stages will appear when a new procurement cycle starts.")} />}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-4" data-testid="chart-project-value">
          <SectionHeader title={tr("قيمة أوامر الشراء حسب المشروع", "PO value by project")} description={tr("أعلى المشاريع من حيث الالتزام المالي الرسمي.", "Projects with the highest formal procurement commitment.")} />
          {projects.length ? <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={projects.slice(0, 8)} layout="vertical" margin={{ left: 12, right: 12 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" /><XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} /><YAxis type="category" dataKey="project_name" width={100} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} /><Tooltip formatter={(value) => fmtEGP(value)} contentStyle={{ background: "hsl(var(--popover))", borderColor: "hsl(var(--border))", color: "hsl(var(--popover-foreground))" }} /><Bar dataKey="formal_po_value" name={tr("قيمة أوامر الشراء", "Purchase order value")} fill="hsl(var(--primary))" radius={[4, 4, 4, 4]} /></BarChart></ResponsiveContainer></div> : <EmptyState compact title={tr("لا توجد قيم مشاريع", "No project values yet")} description={tr("تظهر المقارنة بعد إصدار أول أمر شراء رسمي.", "This view appears after the first formal PO is issued.")} />}
        </section>
      </div>

      <section className="rounded-lg border bg-card p-4" data-testid="po-status-section">
        <SectionHeader title={tr("سلامة التوريد والاستلام", "Delivery and receiving health")} description={tr("مؤشرات تشغيلية مختصرة مع إبراز الاستثناءات.", "A concise operational view focused on exceptions.")} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            [Truck, tr("قيد التوريد", "In delivery"), receiving.in_delivery_count, "info"],
            [PackageCheck, tr("استلام جزئي", "Partial receipt"), receiving.partial_received_count, "warning"],
            [AlertCircle, tr("مشكلات توريد", "Delivery problems"), receiving.delivery_problem_count, "danger"],
            [ClipboardCheck, tr("مكتمل الاستلام", "Receiving complete"), receiving.completed_count, "success"],
          ].map(([Icon, label, value, tone]) => <KpiCard key={label} icon={Icon} label={label} value={value ?? 0} tone={tone} />)}
        </div>
      </section>

      <section data-testid="legacy-direct-purchases">
        <button type="button" onClick={() => setShowLegacy((value) => !value)} className="flex w-full items-center justify-between rounded-lg border bg-muted/50 px-4 py-3 text-start" data-testid="legacy-direct-purchases-toggle"><span><span className="text-sm font-bold text-muted-foreground">{tr("بيانات الشراء المباشر القديمة", "Legacy direct-purchase data")}</span><span className="ms-2 text-xs text-muted-foreground">{tr("منفصلة عن مؤشرات المسار الرسمي", "Separated from formal workflow KPIs")}</span></span><ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showLegacy ? "rotate-180" : ""}`} /></button>
        {showLegacy && <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4"><KpiCard icon={ShoppingCart} label={tr("قيمة الفواتير القديمة", "Legacy invoice value")} value={fmtEGP(dashboard.direct_purchase_total)} testId="kpi-total-purchases" /><KpiCard icon={Receipt} label={tr("عدد الفواتير", "Invoice count")} value={dashboard.direct_purchase_count || 0} /><KpiCard icon={Wallet} label={tr("المدفوع", "Paid")} value={fmtEGP(dashboard.direct_paid_total)} tone="success" /><KpiCard icon={AlertCircle} label={tr("المتبقي", "Outstanding")} value={fmtEGP(dashboard.direct_outstanding_total)} tone="warning" /></div>}
      </section>
    </div>
  );
}
