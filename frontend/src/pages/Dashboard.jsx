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
import api, { fmtEGP } from "@/lib/api";

const ATTENTION_META = {
  delivery_problem: { label: "مشكلة توريد", tone: "danger", action: "مراجعة التوريد" },
  needs_clarification: { label: "يحتاج توضيح", tone: "warning", action: "فتح الطلب" },
  request_review: { label: "مراجعة فنية", tone: "info", action: "مراجعة الطلب" },
  overdue_payment: { label: "دفعة معلقة", tone: "warning", action: "مراجعة الدفعات" },
  rfq_past_deadline: { label: "عرض سعر ناقص", tone: "warning", action: "متابعة RFQ" },
  quotation_missing: { label: "عرض مورد ناقص", tone: "warning", action: "متابعة RFQ" },
  pending_approval: { label: "اعتماد مطلوب", tone: "primary", action: "فتح الاعتماد" },
  awaiting_supplier_confirmation: { label: "تأكيد المورد", tone: "info", action: "فتح أمر الشراء" },
  partial_received: { label: "استلام جزئي", tone: "warning", action: "متابعة الاستلام" },
};

const QUICK_ACTIONS = [
  [Inbox, "الطلبات الواردة", "/incoming-requests"],
  [FileCheck2, "الاعتمادات", "/approvals"],
  [ShoppingCart, "أوامر الشراء", "/purchase-orders"],
  [Wallet, "الدفعات", "/payments"],
];

export default function Dashboard() {
  const navigate = useNavigate();
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
    return <div className="py-20 text-center text-sm text-slate-400">جارٍ تجهيز لوحة العمل...</div>;
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
        title="صباح العمل — ما يحتاج انتباهك اليوم"
        description="ملخص تشغيلي للمسار الرسمي فقط؛ افتح السجل المطلوب مباشرة دون المرور بتقارير وسيطة."
        actions={QUICK_ACTIONS.map(([Icon, label, path]) => (
          <Button key={path} type="button" variant="outline" size="sm" onClick={() => navigate(path)} className="gap-1.5 bg-white">
            <Icon className="h-4 w-4 text-primary" />{label}
          </Button>
        ))}
      />

      <section data-testid="formal-procurement-kpis">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <KpiCard icon={AlertCircle} label="طلبات تحتاج إجراء" value={summary.requests_requiring_action ?? attentionItems.filter((item) => ["needs_clarification", "request_review"].includes(item.type)).length} tone={(summary.requests_requiring_action ?? 0) ? "danger" : "neutral"} testId="kpi-action-required" />
          <KpiCard icon={ClipboardCheck} label="اعتمادات معلقة" value={pendingApprovals} tone={pendingApprovals ? "warning" : "neutral"} testId="kpi-pending-approvals" />
          <KpiCard icon={ShoppingCart} label="أوامر شراء نشطة" value={summary.active_purchase_orders ?? 0} tone="info" testId="kpi-active-pos" />
          <KpiCard icon={Receipt} label="قيمة أوامر الشراء" value={fmtEGP(summary.formal_po_value)} tone="primary" testId="kpi-formal-po-value" />
          <KpiCard icon={Wallet} label="المدفوع فعليًا" value={fmtEGP(summary.actual_paid)} tone="success" testId="kpi-actual-paid" />
          <KpiCard icon={CircleDollarSign} label="المتبقي للموردين" value={fmtEGP(summary.outstanding)} tone="warning" testId="kpi-outstanding" />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="attention-center">
        <SectionHeader
          title="مركز الإجراء"
          description="مرتّب حسب أولوية المتابعة الفعلية عبر التوريد والسداد والعروض والاعتمادات."
          action={<span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{attentionItems.length} سجلات</span>}
        />
        {attentionItems.length ? (
          <div className="divide-y divide-slate-100">
            {attentionItems.slice(0, 10).map((item, index) => {
              const meta = ATTENTION_META[item.type] || { label: item.type, tone: "neutral", action: "فتح" };
              return (
                <div key={`${item.type}-${item.reference}-${index}`} className="grid items-center gap-3 py-3 md:grid-cols-[minmax(150px,0.8fr)_minmax(150px,1fr)_minmax(220px,1.6fr)_auto]" data-testid={`attention-item-${item.type}`}>
                  <div className="min-w-0"><div className="font-mono text-sm font-bold text-slate-900" dir="ltr">{item.reference}</div><StatusBadge tone={meta.tone}>{meta.label}</StatusBadge></div>
                  <div className="min-w-0 text-sm"><div className="truncate font-medium text-slate-800">{item.project_name || "بدون مشروع"}</div>{supplierByReference[item.reference] && <div className="truncate text-xs text-slate-500">{supplierByReference[item.reference]}</div>}</div>
                  <div className="min-w-0"><div className="text-sm text-slate-700">{item.reason}</div>{item.due_or_age && <div className="mt-0.5 text-xs text-slate-400" dir="auto">{item.due_or_age}</div>}</div>
                  <Button type="button" size="sm" variant="outline" onClick={() => navigate(item.path)}>{meta.action}</Button>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState compact icon={ClipboardCheck} title="لا توجد إجراءات عاجلة" description="كل سجلات المسار الرسمي مستقرة حاليًا. ستظهر هنا الطلبات التي تحتاج قرارًا أو متابعة." />
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.35fr]">
        <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="request-pipeline">
          <SectionHeader title="الحركة الحالية" description="توزيع الطلبات عبر مراحل العمل دون تكرار مؤشرات الـKPI." />
          <div className="space-y-2.5">
            {pipeline.filter((row) => row.count > 0).map((row) => (
              <div key={row.key}><div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="text-slate-600">{row.label}</span><b className="tabular-nums text-slate-900">{row.count}</b></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(8, Number(row.count || 0) / maxPipelineCount * 100)}%` }} /></div></div>
            ))}
            {!pipeline.some((row) => row.count > 0) && <EmptyState compact title="لا توجد طلبات نشطة" description="ستظهر مراحل الطلبات هنا عند بدء دورة مشتريات جديدة." />}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="chart-project-value">
          <SectionHeader title="قيمة أوامر الشراء حسب المشروع" description="أعلى المشاريع من حيث الالتزام المالي الرسمي." />
          {projects.length ? <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={projects.slice(0, 8)} layout="vertical" margin={{ left: 12, right: 12 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" /><XAxis type="number" tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="project_name" width={100} tick={{ fontSize: 10 }} /><Tooltip formatter={(value) => fmtEGP(value)} /><Bar dataKey="formal_po_value" name="قيمة أوامر الشراء" fill="hsl(350 70% 34%)" radius={[4, 4, 4, 4]} /></BarChart></ResponsiveContainer></div> : <EmptyState compact title="لا توجد قيم مشاريع" description="تظهر المقارنة بعد إصدار أول أمر شراء رسمي." />}
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="po-status-section">
        <SectionHeader title="سلامة التوريد والاستلام" description="مؤشرات تشغيلية فقط؛ افتح أمر الشراء من مركز الإجراء لمعالجة المشكلة." />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            [Truck, "قيد التوريد", receiving.in_delivery_count, "info"],
            [PackageCheck, "استلام جزئي", receiving.partial_received_count, "warning"],
            [AlertCircle, "مشكلات توريد", receiving.delivery_problem_count, "danger"],
            [ClipboardCheck, "مكتمل الاستلام", receiving.completed_count, "success"],
          ].map(([Icon, label, value, tone]) => <KpiCard key={label} icon={Icon} label={label} value={value ?? 0} tone={tone} />)}
        </div>
      </section>

      <section data-testid="legacy-direct-purchases">
        <button type="button" onClick={() => setShowLegacy((value) => !value)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-start" data-testid="legacy-direct-purchases-toggle"><span><span className="text-sm font-bold text-slate-600">بيانات الشراء المباشر القديمة</span><span className="ms-2 text-xs text-slate-400">منفصلة عن مؤشرات المسار الرسمي</span></span><ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${showLegacy ? "rotate-180" : ""}`} /></button>
        {showLegacy && <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4"><KpiCard icon={ShoppingCart} label="قيمة الفواتير القديمة" value={fmtEGP(dashboard.direct_purchase_total)} testId="kpi-total-purchases" /><KpiCard icon={Receipt} label="عدد الفواتير" value={dashboard.direct_purchase_count || 0} /><KpiCard icon={Wallet} label="المدفوع" value={fmtEGP(dashboard.direct_paid_total)} tone="success" /><KpiCard icon={AlertCircle} label="المتبقي" value={fmtEGP(dashboard.direct_outstanding_total)} tone="warning" /></div>}
      </section>
    </div>
  );
}
