import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowRight, ClipboardList, CreditCard, FileCheck2, FileSearch, History, PackageCheck, ShoppingCart, WalletCards } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg, fmtEGP } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, KpiCard, MoneyDisplay, PageHeader, StatusBadge, Timeline } from "@/components/procurement-ui";
import { usePreferences } from "@/contexts/PreferencesContext";

const STATUS_TONE = { approved: "success", completed: "success", verified: "success", partial_received: "warning", pending_approval: "warning", need_clarification: "warning", delivery_problem: "danger", rejected: "danger", cancelled: "danger", in_delivery: "info", under_review: "info", pricing: "info" };

export default function ProjectPurchases() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const preferences = usePreferences();
  const language = preferences.language || "ar";
  const tr = preferences.tr || ((ar, en) => (language === "en" ? en : ar));
  const locale = preferences.locale || (language === "en" ? "en-EG" : "ar-EG");
  const direction = preferences.direction || (language === "en" ? "ltr" : "rtl");
  const [hub, setHub] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => {
    try { const { data } = await api.get(`/workflow/projects/${projectId}/procurement-hub`); setHub(data); }
    catch (error) { toast.error(errMsg(error)); }
    finally { setLoading(false); }
  })(); }, [projectId]);

  const labels = {
    new: tr("جديد", "New"), under_review: tr("قيد المراجعة", "Under Review"), need_clarification: tr("يحتاج توضيح", "Needs Clarification"), pricing: tr("قيد التسعير", "Pricing"), pending_approval: tr("بانتظار الاعتماد", "Pending Approval"), approved: tr("معتمد", "Approved"), rejected: tr("مرفوض", "Rejected"), cancelled: tr("ملغي", "Cancelled"), in_delivery: tr("قيد التوريد", "In Delivery"), partial_received: tr("استلام جزئي", "Partial Receipt"), delivery_problem: tr("مشكلة استلام", "Receiving Problem"), completed: tr("مكتمل", "Completed"), active: tr("نشط", "Active"), inactive: tr("غير نشط", "Inactive"),
  };

  if (loading) return <div className="py-12 text-center text-sm text-muted-foreground">{tr("جارٍ تحميل مركز المشروع...", "Loading project center...")}</div>;
  if (!hub) return <EmptyState title={tr("تعذر تحميل المشروع", "Project could not be loaded")} description={tr("حاول تحديث الصفحة أو الرجوع لقائمة المشروعات.", "Refresh the page or return to the projects list.")} />;

  const k = hub.kpis || {};
  const formalPayments = hub.formal_payments || [];
  const receivingOrders = (hub.purchase_orders || []).filter((item) => ["in_delivery", "partial_received", "delivery_problem", "completed"].includes(item.status));
  const actions = k.action_priorities || Object.entries(k.actions || {}).filter(([, count]) => count > 0).map(([key, count]) => ({ key, count }));
  const actionLabels = { technical_review: tr("مراجعة فنية", "Technical review"), ready_for_comparison: tr("إعداد مقارنة الموردين", "Prepare supplier comparison"), comparison_approval: tr("اعتماد المقارنة", "Approve comparison"), fund_approval: tr("اعتماد الصرف", "Approve expenditure"), funds_release: tr("تأكيد إتاحة المبلغ", "Confirm funds availability"), ready_for_po: tr("إصدار أمر شراء", "Issue purchase order"), po_review: tr("مراجعة أمر الشراء", "Review purchase order"), under_supply: tr("متابعة التوريد", "Follow up delivery"), partial_receiving: tr("متابعة الاستلام الجزئي", "Follow up partial receipt"), delivery_problem: tr("حل مشكلة الاستلام", "Resolve receiving problem") };

  return <div className="space-y-4" dir={direction}>
    <PageHeader eyebrow={tr("مركز المشروع", "Project Center")} title={hub.project.name} description={[hub.project.customer_name, labels[hub.project.status] || hub.project.status].filter(Boolean).join(" · ")} actions={<Button variant="outline" size="sm" onClick={() => navigate("/projects")}>{direction === "rtl" ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}{tr("المشروعات", "Projects")}</Button>} />

    <section className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6" data-testid="project-formal-kpis">
      <KpiCard icon={ClipboardList} label={tr("طلبات نشطة", "Active REQs")} value={k.active_request_count ?? k.request_count ?? 0} tone="info" />
      <KpiCard icon={ShoppingCart} label={tr("أوامر شراء نشطة", "Active POs")} value={k.active_po_count ?? k.formal_po_count ?? 0} tone="primary" />
      <KpiCard icon={WalletCards} label={tr("قيمة أوامر الشراء", "PO Value")} value={<MoneyDisplay value={k.formal_po_total || 0} />} />
      <KpiCard icon={CreditCard} label={tr("المدفوع", "Paid")} value={<MoneyDisplay value={k.formal_paid_amount || 0} />} tone="success" />
      <KpiCard icon={CreditCard} label={tr("المتبقي", "Outstanding")} value={<MoneyDisplay value={k.formal_outstanding_amount ?? k.formal_po_total ?? 0} />} tone="warning" />
      <KpiCard icon={AlertTriangle} label={tr("مشكلات الاستلام", "Receiving Problems")} value={k.receiving_problem_count ?? k.formal_delivery_problem_count ?? 0} tone={(k.receiving_problem_count || k.formal_delivery_problem_count) ? "danger" : "neutral"} />
    </section>

    <section className="rounded-lg border bg-card p-3" data-testid="project-actions"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-foreground">{tr("الإجراء التالي", "Next action")}</span>{actions.length ? actions.slice(0, 4).map(({ key, count }, index) => <StatusBadge key={key} tone={index === 0 ? "danger" : "warning"}>{actionLabels[key] || key}: {count}</StatusBadge>) : <span className="text-xs text-muted-foreground">{tr("لا توجد إجراءات معلقة للمشروع.", "No pending actions for this project.")}</span>}</div></section>

    <Tabs defaultValue="overview" dir={direction} className="space-y-3">
      <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-lg border bg-card p-1">
        {[["overview", tr("نظرة عامة", "Overview")], ["requests", tr("الطلبات", "Requests")], ["comparisons", tr("المقارنات", "Comparisons")], ["approvals", tr("الاعتمادات", "Approvals")], ["purchase_orders", tr("أوامر الشراء", "Purchase Orders")], ["payments", tr("الدفعات", "Payments")], ["receiving", tr("الاستلام", "Receiving")]].map(([value, label]) => <TabsTrigger key={value} value={value} className="whitespace-nowrap text-xs">{label}</TabsTrigger>)}
      </TabsList>
      <TabPanel value="overview"><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.7fr)]"><div><h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><History className="h-4 w-4" />{tr("آخر النشاط", "Recent activity")}</h3><Timeline events={(hub.timeline || []).slice(0, 8)} emptyLabel={tr("لا يوجد نشاط مسجل بعد.", "No activity has been recorded yet.")} /></div><div><h3 className="mb-3 text-sm font-bold">{tr("بيانات المشروع", "Project details")}</h3><dl className="grid grid-cols-2 gap-2 text-sm">{[[tr("الكود", "Code"), hub.project.code], [tr("المهندس المسؤول", "Responsible engineer"), hub.project.engineer], [tr("المدينة", "City"), hub.project.city], [tr("الحالة", "Status"), labels[hub.project.status] || hub.project.status]].map(([label, value]) => <div key={label} className="rounded-md bg-muted/60 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold">{value || "-"}</dd></div>)}</dl></div></div><TraceabilitySummary chains={hub.traceability || []} tr={tr} />{!!hub.purchases?.length && <details className="mt-4 rounded-md border bg-muted/30 p-3"><summary className="cursor-pointer text-xs font-semibold text-muted-foreground">{tr("بيانات شراء مباشر قديمة (منفصلة عن المؤشرات الرسمية)", "Legacy direct-purchase data (excluded from formal KPIs)")}</summary><div className="mt-3"><RecordCards icon={ShoppingCart} items={hub.purchases} empty="" title={(x) => x.purchase_id} subtitle={(x) => `${x.supplier_name} · ${fmtEGP(x.invoice_total)}`} onOpen={(x) => navigate(`/purchases/${encodeURIComponent(x.purchase_id)}`)} labels={labels} /></div></details>}</TabPanel>
      <TabPanel value="requests"><RecordCards icon={ClipboardList} items={hub.requests || []} empty={tr("لا توجد طلبات شراء مرتبطة.", "No linked purchase requests.")} title={(x) => x.request_number} subtitle={(x) => `${x.requester_name || "-"} · ${x.project_name || hub.project.name}`} status={(x) => x.status} onOpen={(x) => navigate("/incoming-requests", { state: { request_id: x.id } })} labels={labels} /></TabPanel>
      <TabPanel value="comparisons"><RecordCards icon={FileSearch} items={hub.comparisons || []} empty={tr("لا توجد مقارنات مرتبطة.", "No linked comparisons.")} title={(x) => x.comparison_number} subtitle={(x) => `${x.comparison_date || "-"} · ${x.customer_name || "-"}`} onOpen={(x) => navigate("/supplier-price-comparison", { state: { comparison_id: x.id } })} labels={labels} /></TabPanel>
      <TabPanel value="approvals"><RecordCards icon={FileCheck2} items={hub.approvals || []} empty={tr("لا توجد اعتمادات مرتبطة.", "No linked approvals.")} title={(x) => x.approval_number} subtitle={(x) => `${x.engineer_name || tr("اعتماد داخلي", "Internal approval")} · ${fmtEGP(x.final_total)}`} status={(x) => x.status} onOpen={(x) => navigate("/approvals", { state: { approval_id: x.id } })} labels={labels} /></TabPanel>
      <TabPanel value="purchase_orders"><RecordCards icon={ShoppingCart} items={hub.purchase_orders || []} empty={tr("لا توجد أوامر شراء مرتبطة.", "No linked purchase orders.")} title={(x) => x.po_number} subtitle={(x) => `${x.supplier_name || "-"} · ${fmtEGP(x.final_total)}`} status={(x) => x.status} onOpen={(x) => navigate(`/purchase-orders/${x.id}`)} labels={labels} /></TabPanel>
      <TabPanel value="payments"><RecordCards icon={CreditCard} items={formalPayments} empty={tr("لا توجد دفعات رسمية مسجلة لهذا المشروع.", "No formal PO payments are recorded for this project.")} title={(x) => x.payment_number} subtitle={(x) => `${new Date(x.payment_date).toLocaleDateString(locale)} · ${fmtEGP(x.amount)}`} onOpen={(x) => navigate(`/purchase-orders/${x.purchase_order_id}`)} labels={labels} /></TabPanel>
      <TabPanel value="receiving"><RecordCards icon={PackageCheck} items={receivingOrders} empty={tr("لا توجد أوامر في مرحلة الاستلام بعد.", "No purchase orders are in receiving yet.")} title={(x) => x.po_number} subtitle={(x) => `${x.supplier_name || "-"} · ${tr("مستلم", "Received")} ${x.receipt_summary?.received_quantity || 0} ${tr("من", "of")} ${x.receipt_summary?.ordered_quantity || 0}`} status={(x) => x.status} onOpen={(x) => navigate(`/purchase-orders/${x.id}`)} labels={labels} /></TabPanel>
    </Tabs>
  </div>;
}

function TabPanel({ value, children }) { return <TabsContent value={value} forceMount className="rounded-lg border bg-card p-4 focus-visible:ring-2 focus-visible:ring-ring data-[state=inactive]:hidden">{children}</TabsContent>; }

function TraceabilitySummary({ chains, tr }) {
  if (!chains.length) return null;
  return <details className="mt-4 rounded-md border p-3"><summary className="cursor-pointer text-xs font-semibold">{tr("التتبع الرسمي REQ → CMP → APR → PO", "Formal traceability REQ → CMP → APR → PO")}</summary><div className="mt-3 space-y-2">{chains.map((chain) => <div key={chain.request.id} className="rounded-md bg-muted/40 p-2 text-xs"><span className="font-mono font-bold" dir="ltr">{chain.request.request_number}</span>{chain.comparisons.map((comparison) => <span key={comparison.id}> <span className="text-muted-foreground">→</span> <span className="font-mono" dir="ltr">{comparison.comparison_number}</span>{comparison.approvals.map((approval) => <span key={approval.id}> <span className="text-muted-foreground">→</span> <span className="font-mono" dir="ltr">{approval.approval_number}</span>{approval.purchase_orders.map((order) => <span key={order.id}> <span className="text-muted-foreground">→</span> <span className="font-mono" dir="ltr">{order.po_number}</span> <span className="text-muted-foreground">({tr("الاستلام", "received")}: {order.receipt_summary.received_quantity}/{order.receipt_summary.ordered_quantity})</span></span>)}</span>)}</span>)}</div>)}</div></details>;
}

function RecordCards({ icon: Icon, items, empty, title, subtitle, status, onOpen, labels }) {
  if (!items.length) return <EmptyState compact title={empty} />;
  return <div className="grid gap-2 lg:grid-cols-2">{items.map((item, index) => <button type="button" key={item.id || index} onClick={() => onOpen?.(item)} className="flex min-w-0 items-center gap-3 rounded-lg border bg-background p-3 text-start transition-colors hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="rounded-md bg-muted p-2 text-muted-foreground"><Icon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold document-code" dir="auto">{title(item)}</div><div className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle(item)}</div></div>{status && <StatusBadge tone={STATUS_TONE[status(item)] || "neutral"}>{labels[status(item)] || status(item)}</StatusBadge>}</button>)}</div>;
}
