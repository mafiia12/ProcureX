import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, ClipboardCopy, ExternalLink, Mail, MessageCircle, Paperclip, ShieldCheck, ShoppingCart, Undo2, WalletCards, XCircle } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg, fmtEGP } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { buildApprovalUrl, buildEmailUrl, buildWhatsAppUrl } from "@/lib/approvalSharing";
import { useAuth } from "@/contexts/AuthContext";
import { usePreferences } from "@/contexts/PreferencesContext";
import { Callout, EmptyState, KpiStrip, StatusBadge, Timeline } from "@/components/procurement-ui";
import {
  APPROVAL_STAGES, APPROVAL_STAGE_LABELS, approvalProgressStage,
} from "@/lib/approvalStages";
import { formatPriceChangePercent, nonCheapestReasonLabel } from "@/lib/priceComparison";
import { roleAtLeast } from "@/lib/roles";

const DECISION_LABELS = { approved: ["اعتماد", "Approve"], rejected: ["رفض", "Reject"], revision_requested: ["تعديل مطلوب", "Request revision"] };
const QUOTATION_STATUS_LABEL = { draft: ["مسودة", "Draft"], received: ["تم الاستلام", "Received"], withdrawn: ["منسحب", "Withdrawn"] };
const QUOTATION_STATUS_TONE = { draft: "neutral", received: "success", withdrawn: "danger" };

const statusLabels = { draft: ["مسودة", "Draft"], ready_to_send: ["بانتظار الإرسال", "Ready to send"], sent: ["تم فتح المشاركة", "Shared"], pending_approval: ["بانتظار الاعتماد", "Pending approval"], approved: ["معتمد", "Approved"], rejected: ["مرفوض", "Rejected"], revision_requested: ["مطلوب تعديل", "Revision requested"], expired: ["منتهي", "Expired"], cancelled: ["ملغي", "Cancelled"] };
const statusTones = { draft: "neutral", ready_to_send: "info", sent: "info", pending_approval: "warning", approved: "success", rejected: "danger", revision_requested: "warning" };
const roleLabels = { procurement_officer: ["مسؤول المشتريات", "Procurement Officer"], procurement_engineer: ["مهندس المشتريات", "Procurement Engineer"], procurement_responsible: ["مسؤول المشتريات", "Procurement Lead"], commercial_manager: ["المدير التجاري", "Commercial Manager"], external_engineer: ["المهندس الخارجي", "External Engineer"], admin: ["المدير", "Administrator"] };
const paymentLabels = { not_started: ["لم يبدأ", "Not started"], pending: ["بانتظار الدفع", "Pending payment"], proof_submitted: ["رُفع الإثبات", "Proof submitted"], under_review: ["تحت المراجعة", "Under review"], verified: ["مدفوع", "Verified"], rejected: ["مرفوض", "Rejected"], cancelled: ["ملغي", "Cancelled"] };
const stageEnglish = {
  comparison_technical: "Supplier comparison approval",
  fund_release: "Commercial / expenditure approval",
  funds_release: "Confirm funds availability",
  po_ready: "Ready for purchase order",
  external_review: "Legacy external review",
};
const dictionaryLabel = (dictionary, key, tr, fallback = key) => dictionary[key] ? tr(...dictionary[key]) : fallback;
const stageLabel = (stage, tr) => tr(APPROVAL_STAGE_LABELS[stage] || stage, stageEnglish[stage] || stage);

export default function ApprovalsCommandCenter() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tr, direction } = usePreferences();
  const role = user?.role || "";
  const [data, setData] = useState({ items: [], counts: {}, payment_counts: {} });
  const [selected, setSelected] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [filters, setFilters] = useState({ search: "", status: "" });
  const [actor, setActor] = useState("");
  const [note, setNote] = useState("");
  const [cashCode, setCashCode] = useState("");
  const [releaseMethod, setReleaseMethod] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmAction, setConfirmAction] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const response = await api.get("/workflow/approvals", { params: filters }); setData(response.data); }
    catch (error) { toast.error(errMsg(error)); }
    finally { setLoading(false); }
  }, [filters]);
  const open = useCallback(async (id) => {
    try {
      const { data: detail } = await api.get(`/workflow/approvals/${id}`);
      setSelected(detail);
      try {
        const { data: workspaceDetail } = await api.get(`/workflow/approvals/${id}/review-workspace`);
        setWorkspace(workspaceDetail);
      } catch {
        setWorkspace(null);
      }
    } catch (error) { toast.error(errMsg(error)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (location.state?.approval_id) open(location.state.approval_id); }, [location.state?.approval_id, open]);

  const refresh = async () => { if (selected) await open(selected.id); await load(); };
  const legacyAction = async (path, body = { actor }) => { try { await api.post(path, body); toast.success(tr("تم تسجيل الإجراء", "Action recorded")); await refresh(); } catch (error) { toast.error(errMsg(error)); } };
  const decide = async (decision) => {
    try {
      await api.post(`/workflow/approvals/${selected.id}/decision`, { decision, actor, note });
      setNote(""); toast.success(tr("تم تسجيل قرار الاعتماد", "Approval decision recorded")); await refresh();
    } catch (error) { toast.error(errMsg(error)); }
  };
  const requestDecision = (decision) => setConfirmAction({ decision });
  const confirmDecision = async () => {
    if (!confirmAction) return;
    if (confirmAction.decision !== "approved" && !note.trim()) {
      toast.error(tr("سبب الرفض أو طلب التعديل مطلوب", "A reason is required for rejection or revision"));
      return;
    }
    await decide(confirmAction.decision);
    setConfirmAction(null);
  };
  const releaseFunds = async () => {
    try {
      await api.post(`/workflow/approvals/${selected.id}/funds-release`, { actor, note, method: releaseMethod });
      setNote(""); toast.success(tr("تم تأكيد إتاحة المبلغ لمسؤول المشتريات", "Funds availability confirmed for procurement")); await refresh();
    } catch (error) { toast.error(errMsg(error)); }
  };
  const createDraftPO = async () => {
    try {
      const { data: result } = await api.post("/purchase-orders/from-comparison", {
        comparison_id: selected.comparison_id, po_date: new Date().toISOString().slice(0, 10),
        created_by: actor, orders: [],
      });
      toast.success(tr(`تم إنشاء ${result.count} أمر شراء للمراجعة`, `${result.count} purchase order(s) created for review`));
      navigate(`/purchase-orders/${result.purchase_orders[0].id}`);
    } catch (error) { toast.error(errMsg(error)); }
  };
  const share = async (channel) => {
    if (!selected?.secure_token) return;
    const url = buildApprovalUrl(selected.secure_token);
    try {
      if (channel === "copy") await navigator.clipboard.writeText(url);
      if (channel === "whatsapp") window.open(buildWhatsAppUrl(selected, url), "_blank", "noopener,noreferrer");
      if (channel === "gmail") window.location.href = buildEmailUrl(selected, url);
      await api.post(`/workflow/approvals/${selected.id}/share-event`, { channel, actor });
      toast.success(tr("تم فتح وسيلة المشاركة؛ لا يُعد ذلك تأكيد تسليم", "Sharing channel opened; this does not confirm delivery"));
    } catch (error) { toast.error(errMsg(error)); }
  };

  const internalItems = data.items.filter((item) => item.approval_type === "comparison_workflow");
  const legacyItems = data.items.filter((item) => item.approval_type !== "comparison_workflow");
  const pendingTechnical = internalItems.filter((item) => item.status === "pending_approval" && item.approval_stage === APPROVAL_STAGES.COMPARISON_TECHNICAL).length;
  const pendingFund = internalItems.filter((item) => item.status === "pending_approval" && item.approval_stage === APPROVAL_STAGES.EXPENDITURE_APPROVAL).length;
  const pendingRelease = internalItems.filter((item) => item.status === "pending_approval" && item.approval_stage === APPROVAL_STAGES.FUNDS_AVAILABILITY).length;
  const canAct = selected?.approval_type === "comparison_workflow" && selected.status === "pending_approval" && roleAtLeast(role, selected.responsible_role);
  const currentStage = approvalProgressStage(selected?.approval_stage);

  return <div className="space-y-3" data-testid="approvals-command-center">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2" data-testid="approval-command-header">
      <div><h1 className="text-base font-bold tracking-tight">{tr("مركز الاعتمادات", "Approval Center")}</h1><p className="mt-0.5 text-xs text-muted-foreground">{tr("القرار الحالي أولًا، والتفاصيل الداعمة عند الحاجة.", "Current decision first; supporting detail on demand.")}</p></div>
      <div className="flex items-center gap-2 border bg-card px-2 py-1 text-xs"><span className="text-muted-foreground">{tr("الدور", "Role")}</span><b>{dictionaryLabel(roleLabels, role, tr, role)}</b></div>
    </div>
    <KpiStrip
      items={[
        { label: tr("اعتماد المقارنة", "Comparison approval"), value: pendingTechnical, tone: "info" },
        { label: tr("موافقة تجارية", "Commercial approval"), value: pendingFund, tone: "warning" },
        { label: tr("إتاحة المبلغ", "Funds availability"), value: pendingRelease, tone: "warning" },
        { label: tr("جاهز لأمر شراء", "Ready for PO"), value: internalItems.filter((item) => item.status === "approved" && item.approval_stage === APPROVAL_STAGES.PO_READY && !item.has_purchase_order).length, tone: "success" },
      ]}
    />
    <div className="grid gap-2 border bg-card p-2 md:grid-cols-[1fr_220px_1fr]"><Input className="h-8 text-xs" placeholder={tr("رقم الاعتماد أو المشروع", "Approval number or project")} value={filters.search} onChange={(event) => setFilters((value) => ({ ...value, search: event.target.value }))} /><select className="h-8 rounded-md border bg-background px-2 text-xs" value={filters.status} onChange={(event) => setFilters((value) => ({ ...value, status: event.target.value }))}><option value="">{tr("كل حالات الاعتماد", "All approval statuses")}</option>{Object.entries(statusLabels).map(([value, labels]) => <option key={value} value={value}>{tr(...labels)}</option>)}</select><Input className="h-8 text-xs" placeholder={tr("اسم منفذ الإجراء", "Action owner name")} value={actor} onChange={(event) => setActor(event.target.value)} /></div>
    <div className="grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
      <section className="space-y-1.5">{loading ? <div className="border bg-card p-6 text-center text-xs text-muted-foreground">{tr("جارٍ التحميل...", "Loading...")}</div> : !data.items.length ? <EmptyState compact title={tr("لا توجد اعتمادات مطابقة", "No matching approvals")} description={tr("ستظهر هنا الاعتمادات التي تدخل المسار الرسمي.", "Formal workflow approvals will appear here.")} /> : <>{internalItems.map((item) => <ApprovalCard key={item.id} item={item} selected={selected} onOpen={open} tr={tr} />)}{!!legacyItems.length && <details className="border bg-card p-2"><summary className="cursor-pointer text-xs font-bold text-muted-foreground">{tr(`المسار الخارجي القديم (${legacyItems.length})`, `Legacy external workflow (${legacyItems.length})`)}</summary><div className="mt-2 space-y-1.5">{legacyItems.map((item) => <ApprovalCard key={item.id} item={item} selected={selected} onOpen={open} tr={tr} />)}</div></details>}</>}</section>
      <section className="border bg-card">{!selected ? <EmptyState className="min-h-[240px]" title={tr("اختر اعتمادًا", "Select an approval")} description={tr("اعرض ملخص القرار والمستندات الداعمة هنا.", "Its decision summary and supporting documents will appear here.")} /> : <div>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-3 py-2"><div><h3 className="text-sm font-bold" dir="ltr">{selected.approval_number}</h3><p className="text-[10.5px] text-muted-foreground">{selected.project_name || tr("بدون مشروع", "No project")} · {tr(`الإصدار ${selected.revision_number + 1}`, `Revision ${selected.revision_number + 1}`)}</p></div><StatusBadge tone={statusTones[selected.status] || "neutral"}>{dictionaryLabel(statusLabels, selected.status, tr, selected.status)}</StatusBadge></div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-b bg-muted/30 px-3 py-2 text-xs md:grid-cols-3 xl:grid-cols-6" data-testid="approval-decision-summary">
          {[[tr("المشروع", "Project"), selected.project_name || "-"], ["REQ", selected.source_request_number || "-"], ["CMP", selected.comparison_number || "-"], [tr("الإجمالي", "Total"), fmtEGP(selected.final_total)], [tr("المرحلة", "Stage"), stageLabel(selected.approval_stage, tr)], [tr("المسؤول", "Responsible"), dictionaryLabel(roleLabels, selected.responsible_role, tr, selected.responsible_role)]].map(([label, value]) => <div key={label} className="min-w-0"><div className="text-[9.5px] uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-0.5 truncate font-semibold" title={String(value)} dir={["REQ", "CMP"].includes(label) ? "ltr" : "auto"}>{value}</div></div>)}
        </div>
        <div className="space-y-2 p-2.5">
          {selected.approval_type === "comparison_workflow" ? <InternalApproval selected={selected} role={role} note={note} setNote={setNote} canAct={canAct} currentStage={currentStage} requestDecision={requestDecision} action={legacyAction} releaseFunds={releaseFunds} releaseMethod={releaseMethod} setReleaseMethod={setReleaseMethod} createDraftPO={createDraftPO} navigate={navigate} tr={tr} /> : <LegacyApproval selected={selected} actor={actor} cashCode={cashCode} setCashCode={setCashCode} action={legacyAction} share={share} tr={tr} />}
          <ReviewWorkspace workspace={workspace} timeline={selected.timeline || []} />
        </div>
      </div>}</section>
    </div>
    <Dialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
      <DialogContent dir={direction} data-testid="decision-confirm-dialog">
        <DialogHeader>
          <DialogTitle className="text-start">{tr("تأكيد القرار", "Confirm decision")}</DialogTitle>
          <DialogDescription className="text-start">{tr("راجع بيانات القرار قبل التأكيد؛ لا يمكن التراجع عنه تلقائيًا.", "Review the decision before confirming; it cannot be reversed automatically.")}</DialogDescription>
        </DialogHeader>
        {confirmAction && selected && <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3">
            <div>{tr("رقم الاعتماد", "Approval number")}<br /><b dir="ltr">{selected.approval_number}</b></div>
            <div>{tr("القرار", "Decision")}<br /><b>{dictionaryLabel(DECISION_LABELS, confirmAction.decision, tr)}</b></div>
            <div>{tr("المرحلة الحالية", "Current stage")}<br /><b>{stageLabel(selected.approval_stage, tr)}</b></div>
            <div>{tr("الإجمالي", "Total")}<br /><b>{fmtEGP(selected.final_total)}</b></div>
          </div>
          <Textarea
            data-testid="decision-note-input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={confirmAction.decision === "approved" ? tr("ملاحظة اختيارية", "Optional note") : tr("سبب الرفض أو طلب التعديل (مطلوب)", "Reason for rejection or revision (required)")}
          />
        </div>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setConfirmAction(null)}>{tr("إلغاء", "Cancel")}</Button>
          <Button data-testid="decision-confirm-button" onClick={confirmDecision}>{tr("تأكيد", "Confirm")} {confirmAction && dictionaryLabel(DECISION_LABELS, confirmAction.decision, tr)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

function ApprovalProgressInline({ currentStage, tr }) {
  const stages = [
    ["REQ", 1], ["CMP", 2], ["APR", 3], [tr("تجاري", "Commercial"), 4],
    [tr("إتاحة", "Funds"), 5], ["PO", 6],
  ];
  return <div className="flex items-center gap-1 overflow-x-auto border bg-muted/25 px-2 py-1 text-[9.5px] font-semibold text-muted-foreground" data-testid="approval-progress-inline">
    {stages.map(([label, value], index) => <span key={value} className="flex shrink-0 items-center gap-1">
      <span className={value === currentStage ? "bg-primary/10 px-1 py-0.5 text-primary" : value < currentStage ? "text-emerald-700 dark:text-emerald-300" : ""}>{label}{value < currentStage ? " ✓" : value === currentStage ? " ●" : ""}</span>
      {index < stages.length - 1 && <span aria-hidden="true">{tr("←", "→")}</span>}
    </span>)}
  </div>;
}

function InternalApproval({ selected, role, note, setNote, canAct, currentStage, requestDecision, action, releaseFunds, releaseMethod, setReleaseMethod, createDraftPO, navigate, tr }) {
  const isRelease = selected.status === "pending_approval" && selected.approval_stage === APPROVAL_STAGES.FUNDS_AVAILABILITY;
  const readyForPO = selected.status === "approved" && selected.approval_stage === APPROVAL_STAGES.PO_READY;
  const linkedOrders = selected.purchase_orders || [];
  const hasPurchaseOrders = readyForPO && linkedOrders.length > 0;
  const canReleaseFunds = roleAtLeast(role, "commercial_manager");
  const canCreatePO = roleAtLeast(role, "procurement_responsible");
  return <><ApprovalProgressInline currentStage={currentStage} tr={tr} /><div className={`flex flex-wrap items-center justify-between gap-2 border px-2.5 py-2 ${readyForPO ? "border-emerald-500/30 bg-emerald-500/5" : "border-primary/20 bg-primary/5"}`} data-testid="approval-next-decision"><div><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{tr("المطلوب الآن", "Decision required now")}</div><div className="mt-0.5 text-sm font-bold">{hasPurchaseOrders ? tr("تم إنشاء أمر الشراء", "Purchase order created") : stageLabel(selected.approval_stage, tr)}</div></div><div className="text-xs text-muted-foreground">{tr("المسؤول", "Responsible")}: <b className="text-foreground">{dictionaryLabel(roleLabels, selected.responsible_role, tr, selected.responsible_role)}</b></div></div>
    {selected.status === "pending_approval" && !isRelease && <div>{canAct ? <div className="sticky bottom-2 z-10 flex flex-wrap gap-1.5 border bg-card/95 p-1.5 shadow-sm backdrop-blur" data-testid="approval-decision-actions"><Button size="sm" onClick={() => requestDecision("approved")} className="h-8 bg-emerald-700 text-white hover:bg-emerald-800"><ShieldCheck className="h-4 w-4" /> {selected.approval_stage === APPROVAL_STAGES.COMPARISON_TECHNICAL ? tr("اعتماد المقارنة", "Approve comparison") : tr("موافقة تجارية / اعتماد الصرف", "Commercial / expenditure approval")}</Button><Button size="sm" variant="outline" className="h-8" onClick={() => requestDecision("revision_requested")}><Undo2 className="h-4 w-4" />{tr("تعديل مطلوب", "Request revision")}</Button><Button size="sm" variant="destructive" className="h-8" onClick={() => requestDecision("rejected")}><XCircle className="h-4 w-4" />{tr("رفض", "Reject")}</Button></div> : <RoleNotice selected={selected} role={role} tr={tr} />}</div>}
    {isRelease && <Callout tone="primary" className="block space-y-3"><div className="font-bold text-foreground">{tr("الموافقة التجارية / اعتماد الصرف مكتمل — المبلغ لم يُتح بعد", "Commercial approval is complete — funds are not yet available")}</div><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={releaseMethod} onChange={(event) => setReleaseMethod(event.target.value)}><option value="">{tr("طريقة الإتاحة (اختياري)", "Availability method (optional)")}</option><option value="cash">{tr("نقدي", "Cash")}</option><option value="transfer">{tr("تحويل", "Transfer")}</option><option value="custody">{tr("عهدة", "Custody")}</option><option value="other">{tr("أخرى", "Other")}</option></select><Input value={note} onChange={(event) => setNote(event.target.value)} placeholder={tr("ملاحظة اختيارية", "Optional note")} />{canReleaseFunds ? <Button className="w-full" onClick={releaseFunds}><WalletCards className="h-5 w-5" />{tr("تأكيد إتاحة المبلغ لمسؤول المشتريات", "Confirm funds availability for procurement")}</Button> : <RoleNotice selected={selected} role={role} tr={tr} />}</Callout>}
    {readyForPO && (hasPurchaseOrders
      ? <Callout tone="success" testId="po-created-state" className="block">
          <div className="flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-300"><CheckCircle2 className="h-5 w-5" />{tr("تم إنشاء أمر الشراء", "Purchase order created")}</div>
          <div className="mt-1 text-sm text-muted-foreground">{linkedOrders.length > 1
            ? tr(`تم إنشاء ${linkedOrders.length} أوامر شراء لهذا الاعتماد.`, `${linkedOrders.length} purchase orders were created for this approval.`)
            : tr("تم إنشاء أمر الشراء لهذا الاعتماد.", "A purchase order was created for this approval.")}</div>
          <Button
            className="mt-3 w-full"
            variant="outline"
            data-testid="open-created-purchase-orders"
            onClick={() => navigate(linkedOrders.length === 1 ? `/purchase-orders/${linkedOrders[0].id}` : "/purchase-orders")}
          >
            <ShoppingCart className="h-5 w-5" />
            {linkedOrders.length === 1
              ? tr("فتح أمر الشراء", "Open purchase order")
              : tr(`عرض أوامر الشراء (${linkedOrders.length})`, `View purchase orders (${linkedOrders.length})`)}
          </Button>
        </Callout>
      : <Callout tone="success" className="block"><div className="font-bold text-emerald-800 dark:text-emerald-300">{tr("🟢 التمويل متاح", "Funds available")}</div><div className="mt-1 text-sm text-muted-foreground">{tr("جاهز لإصدار أمر شراء ومراجعته", "Ready to create and review a purchase order")}</div>{canCreatePO ? <Button className="mt-3 w-full" onClick={createDraftPO}><ShoppingCart className="h-5 w-5" />{tr("إنشاء أوامر الشراء للمراجعة", "Create purchase orders for review")}</Button> : <RoleNotice selected={selected} role={role} tr={tr} />}</Callout>
    )}
    {selected.status === "revision_requested" && <Button onClick={() => action(`/workflow/approvals/${selected.id}/revision`)}>{tr("إنشاء إصدار معدل", "Create revised version")}</Button>}</>;
}

function RoleNotice({ selected, role, tr }) {
  return <Callout tone="warning"><span className="text-sm">{tr("يمكنك مشاهدة المسار، لكن الإجراء متاح الآن لـ", "You can view this workflow, but the action is currently assigned to")} {dictionaryLabel(roleLabels, selected.responsible_role, tr, selected.responsible_role)} {tr("فقط. دورك الحالي:", "only. Your current role:")} {dictionaryLabel(roleLabels, role, tr, role)}.</span></Callout>;
}

function ApprovalCard({ item, selected, onOpen, tr }) {
  return <button type="button" onClick={() => onOpen(item.id)} className={`w-full border bg-card p-2 text-start transition-colors hover:border-primary/40 ${selected?.id === item.id ? "border-primary bg-primary/5 ring-1 ring-primary/30" : ""}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><b className="text-sm" dir="ltr">{item.approval_number}</b><div className="mt-0.5 truncate text-xs text-muted-foreground">{item.project_name || tr("بدون مشروع", "No project")} · {tr(`الإصدار ${item.revision_number + 1}`, `Revision ${item.revision_number + 1}`)}</div></div><StatusBadge tone={statusTones[item.status] || "neutral"}>{dictionaryLabel(statusLabels, item.status, tr, item.status)}</StatusBadge></div><div className="mt-1.5 flex items-end justify-between gap-2"><div className="min-w-0 truncate text-[10.5px] text-muted-foreground">{stageLabel(item.approval_stage, tr)} · {dictionaryLabel(roleLabels, item.responsible_role, tr, "-")}</div><b className="shrink-0 text-xs" dir="ltr">{fmtEGP(item.final_total)}</b></div></button>;
}

function LegacyApproval({ selected, actor, cashCode, setCashCode, action, share, tr }) {
  return <div className="space-y-4"><Callout tone="warning"><span className="text-sm">{tr("هذا اعتماد خارجي قديم؛ أدوات المشاركة محفوظة للتوافق ولا تختلط بمسار الاعتمادات الداخلي.", "This is a legacy external approval; sharing tools remain for compatibility and are separate from the internal workflow.")}</span></Callout><div className="grid grid-cols-2 gap-2 border bg-muted/50 p-3 text-sm"><div>{tr("المهندس", "Engineer")}<br/><b>{selected.engineer_name || "-"}</b></div><div>{tr("الإجمالي", "Total")}<br/><b>{fmtEGP(selected.final_total)}</b></div></div><div className="flex flex-wrap gap-2">{selected.status === "draft" && <Button onClick={() => action(`/workflow/approvals/${selected.id}/ready`)}><CheckCircle2 className="h-4 w-4" />{tr("جاهز للإرسال", "Ready to send")}</Button>}{selected.status === "ready_to_send" && <Button onClick={() => action(`/workflow/approvals/${selected.id}/sent`)}><ExternalLink className="h-4 w-4" />{tr("تسجيل فتح المشاركة", "Record share opened")}</Button>}{selected.status === "revision_requested" && <Button onClick={() => action(`/workflow/approvals/${selected.id}/revision`)}>{tr("إنشاء الإصدار التالي", "Create next revision")}</Button>}<Button variant="outline" onClick={() => share("copy")}><ClipboardCopy className="h-4 w-4" />{tr("نسخ الرابط", "Copy link")}</Button><Button variant="outline" disabled={!selected.engineer_phone} onClick={() => share("whatsapp")}><MessageCircle className="h-4 w-4" />WhatsApp</Button><Button variant="outline" disabled={!selected.engineer_email} onClick={() => share("gmail")}><Mail className="h-4 w-4" />{tr("بريد", "Email")}</Button></div><details className="rounded-xl border p-3"><summary className="cursor-pointer font-bold">{tr("سجل المدفوعات المنفصل", "Separate legacy payment history")}</summary><div className="mt-3 space-y-2">{!selected.payments.length ? <div className="text-sm text-muted-foreground">{tr("لا توجد دفعات.", "No payments.")}</div> : selected.payments.map((payment) => <div key={payment.id} className="rounded-lg border p-3"><div className="flex justify-between"><b>{payment.method}</b><span>{dictionaryLabel(paymentLabels, payment.status, tr, payment.status)}</span></div><div className="mt-1 text-sm">{fmtEGP(payment.amount)}</div>{payment.status === "under_review" && <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => action(`/workflow/payments/${payment.id}/verify`)}>{tr("تحقق", "Verify")}</Button><Button size="sm" variant="destructive" onClick={() => action(`/workflow/payments/${payment.id}/reject`)}>{tr("رفض", "Reject")}</Button></div>}{payment.method === "cash" && payment.status === "pending" && <div className="mt-2 flex gap-2"><Input value={cashCode} onChange={(event) => setCashCode(event.target.value.toUpperCase())} placeholder="CASH-XXXXXX" /><Button onClick={() => action(`/workflow/payments/${payment.id}/confirm-cash`, { cash_reference: cashCode, actor })}>{tr("تأكيد النقد", "Confirm cash")}</Button></div>}</div>)}</div></details></div>;
}

const INLINE_VIEWABLE_ATTACHMENT_TYPES = new Set(["application/pdf"]);
const isInlineViewableAttachment = (mediaType) =>
  typeof mediaType === "string"
  && (INLINE_VIEWABLE_ATTACHMENT_TYPES.has(mediaType) || mediaType.startsWith("image/"));

// Fetches the attachment as an authenticated blob before doing anything else -
// never opens a tab/window ahead of a confirmed, non-empty Blob, which is what
// previously left users staring at a stuck about:blank tab on failure.
async function downloadWorkspaceFile(path, { filename, mediaType, failureMessage } = {}) {
  try {
    const response = await api.get(path, { responseType: "blob" });
    const blob = response.data;
    if (!(blob instanceof Blob) || blob.size === 0) throw new Error("empty-attachment-response");
    const resolvedType = mediaType || blob.type;
    const url = URL.createObjectURL(blob);
    if (isInlineViewableAttachment(resolvedType)) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || "attachment";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    toast.error(failureMessage || errMsg(error));
  }
}

function AttachmentRow({ attachment, requestId }) {
  const path = attachment.source === "general"
    ? `/internal/incoming-purchase-requests/${requestId}/general-attachments/${attachment.id}`
    : `/internal/incoming-purchase-requests/${requestId}/attachments/${attachment.id}`;
  const open = () => downloadWorkspaceFile(path, { filename: attachment.original_filename, mediaType: attachment.media_type });
  return <button type="button" onClick={open} className="flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-xs hover:bg-muted/50" data-testid="request-attachment-row">
    <span className="flex items-center gap-1"><Paperclip className="h-3 w-3" /> {attachment.original_filename}</span>
    <span className="text-muted-foreground">{((attachment.size_bytes || 0) / 1024).toFixed(0)} KB</span>
  </button>;
}

function QuotationAttachmentLink({ rfqId, quotationId, attachment }) {
  const { tr } = usePreferences();
  const path = `/workflow/rfqs/${rfqId}/quotations/${quotationId}/attachments/${attachment.id}`;
  const open = () => downloadWorkspaceFile(path, {
    filename: attachment.original_filename,
    mediaType: attachment.media_type,
    failureMessage: tr("تعذر فتح مرفق عرض المورد", "Could not open the supplier quotation attachment."),
  });
  return <button type="button" onClick={open} className="border bg-blue-500/10 px-2 py-1 text-xs text-blue-700 hover:bg-blue-500/20 dark:text-blue-300" data-testid="quotation-attachment-link">
    <Paperclip className="me-1 inline h-3 w-3" /> {attachment.original_filename}
  </button>;
}

function ReviewWorkspace({ workspace, timeline = [] }) {
  const { tr, direction, language } = usePreferences();
  if (!workspace) return null;
  const request = workspace.request || null;
  const items = workspace.request_items || [];
  const attachments = workspace.request_attachments || [];
  const technicalReview = workspace.technical_review || null;
  const rfq = workspace.rfq || null;
  const quotations = workspace.supplier_quotations || [];
  const comparison = workspace.comparison || null;
  // Decision-quality audit context: what was true AT THE TIME Procurement
  // selected a non-cheapest supplier (see backend's non_cheapest_supplier_
  // selected audit event) - never recomputed from the live comparison, so
  // it stays correct even if prices change afterward.
  const nonCheapestEvent = timeline.find((event) => event.event_type === "non_cheapest_supplier_selected");
  const nonCheapestDecisions = nonCheapestEvent?.metadata_json?.decisions || [];

  return <Tabs defaultValue="request" dir={direction} className="border bg-muted/20 p-2" data-testid="review-workspace">
    <TabsList className="flex h-8 w-full justify-start overflow-x-auto">
      {[["request", tr("الطلب", "Request")], ["technical", tr("المراجعة الفنية", "Technical review")], ["quotations", tr("عروض الموردين", "Supplier quotations")], ["comparison", tr("المقارنة", "Comparison")], ["attachments", tr("المرفقات", "Attachments")], ["history", tr("السجل", "History")]].map(([value, label]) => <TabsTrigger key={value} value={value} className="h-7 px-2 text-xs">{label}</TabsTrigger>)}
    </TabsList>

    <TabsContent value="request" forceMount className="data-[state=inactive]:hidden"><section className="rounded-lg border bg-card p-3" data-testid="review-workspace-request">
      <h4 className="mb-2 text-sm font-bold">{tr("طلب الشراء", "Purchase request")}</h4>
      {!request ? <div className="text-sm text-muted-foreground">{tr("غير متاح / سجل سابق", "Unavailable / legacy record")}</div> : <>
        <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
          <div>{tr("مقدم الطلب", "Requester")}<br /><b>{request.requester_name || "-"}</b></div>
          <div>{tr("نوع مقدم الطلب", "Requester type")}<br /><b>{request.requester_type === "site_portal" ? tr("مهندس موقع (بوابة)", "Site Engineer (Portal)") : tr("عام", "General")}</b></div>
          <div>{tr("المشروع", "Project")}<br /><b>{request.project_name || "-"}</b></div>
          <div>{tr("التسليم المطلوب", "Required delivery")}<br /><b>{request.required_delivery_date || "-"}</b></div>
          <div>{tr("الأولوية", "Priority")}<br /><b>{request.priority || "-"}</b></div>
          <div>{tr("وجهة التسليم", "Delivery destination")}<br /><b>{request.delivery_destination || "-"}</b></div>
        </div>
        {request.notes && <div className="mt-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">{request.notes}</div>}
        <div className="mt-3 border">
          <Table>
            <TableHeader>
              <TableRow className="h-8">
                <TableHead className="text-[10px] font-bold uppercase tracking-wide">{tr("الصنف", "Item")}</TableHead>
                <TableHead className="w-20 text-end text-[10px] font-bold uppercase tracking-wide">{tr("الكمية", "Qty")}</TableHead>
                <TableHead className="w-28 text-[10px] font-bold uppercase tracking-wide">{tr("المصدر", "Source")}</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wide">{tr("الحالة الفنية", "Technical status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => <TableRow key={item.id} data-testid="review-workspace-request-item">
                <TableCell className="py-1.5">
                  <div className="font-semibold text-foreground">{item.product_name}</div>
                  {item.specifications && <div className="truncate text-[10.5px] text-muted-foreground">{item.specifications}</div>}
                </TableCell>
                <TableCell className="py-1.5 text-end tabular-nums">{item.quantity} {item.unit}</TableCell>
                <TableCell className="py-1.5">{item.is_manual
                  ? <StatusBadge tone="warning">{tr("يدوي", "Manual")}</StatusBadge>
                  : <StatusBadge tone="info">{tr("دليل الأصناف", "Item master")}</StatusBadge>}</TableCell>
                <TableCell className="py-1.5 text-xs text-muted-foreground"><b className="text-foreground">{item.review_status}</b>{item.review_reason && <> — {item.review_reason}</>}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
        </div>
      </>}
    </section></TabsContent>

    <TabsContent value="attachments" forceMount className="data-[state=inactive]:hidden"><section className="rounded-lg border bg-card p-3">
      <h4 className="mb-2 text-sm font-bold">{tr("المرفقات", "Attachments")}</h4>
      {!attachments.length
        ? <div className="text-sm text-muted-foreground">{tr("لا توجد مرفقات.", "No attachments.")}</div>
        : <div className="space-y-1">{attachments.map((row) => (
          <AttachmentRow key={row.id} attachment={row} requestId={request?.id} />
        ))}</div>}
    </section></TabsContent>

    <TabsContent value="technical" forceMount className="space-y-3 data-[state=inactive]:hidden"><section className="rounded-lg border bg-card p-3">
      <h4 className="mb-2 text-sm font-bold">{tr("المراجعة الفنية", "Technical review")}</h4>
      {!technicalReview || !technicalReview.reviewed
        ? <div className="text-sm text-muted-foreground">{tr("غير متاح / سجل سابق", "Unavailable / legacy record")}</div>
        : <div className="text-sm">{tr("راجعها", "Reviewed by")} <b>{technicalReview.reviewed_by || "-"}</b>{technicalReview.reviewed_at && <> — {new Date(technicalReview.reviewed_at).toLocaleString(direction === "rtl" ? "ar-EG" : "en-EG")}</>}</div>}
    </section>

    <section className="rounded-lg border bg-card p-3" data-testid="review-workspace-rfq">
      <h4 className="mb-2 text-sm font-bold">{tr("RFQ والموردون", "RFQ and suppliers")}</h4>
      {!rfq
        ? <div className="text-sm text-muted-foreground" data-testid="review-workspace-no-rfq">{tr("لم يتم إنشاء RFQ لهذا الطلب", "No RFQ has been created for this request")}</div>
        : <div className="text-sm">
          <div className="flex flex-wrap gap-3"><b dir="ltr">{rfq.rfq_number}</b><span>{tr(`${rfq.supplier_count} مورد`, `${rfq.supplier_count} suppliers`)}</span><span>{tr(`${rfq.received_quotation_count} عرض مستلم`, `${rfq.received_quotation_count} quotations received`)}</span>{rfq.deadline && <span>{tr("الموعد النهائي", "Deadline")}: {rfq.deadline}</span>}</div>
          <div className="mt-2 flex flex-wrap gap-1">{rfq.suppliers.map((supplier) => (
            <span key={supplier.supplier_id || supplier.supplier_name} className="rounded bg-muted px-2 py-1 text-xs">{supplier.supplier_name}</span>
          ))}</div>
        </div>}
    </section></TabsContent>

    <TabsContent value="quotations" forceMount className="data-[state=inactive]:hidden">{!!quotations.length ? <section className="rounded-lg border bg-card p-3" data-testid="review-workspace-quotations">
      <h4 className="mb-2 text-sm font-bold">{tr("عروض أسعار الموردين", "Supplier quotations")}</h4>
      <div className="space-y-3">{quotations.map((quotation) => (
        <div key={quotation.id} className="rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b>{quotation.supplier_name}</b>
            <StatusBadge tone={QUOTATION_STATUS_TONE[quotation.status] || "neutral"}>
              {dictionaryLabel(QUOTATION_STATUS_LABEL, quotation.status, tr, quotation.status)}
            </StatusBadge>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {quotation.quotation_ref && <span>{tr("مرجع", "Reference")}: {quotation.quotation_ref}</span>}
            {quotation.quotation_date && <span>{tr("تاريخ", "Date")}: {quotation.quotation_date}</span>}
            {quotation.valid_until && <span>{tr("صالح حتى", "Valid until")}: {quotation.valid_until}</span>}
            {quotation.payment_terms && <span>{tr("شروط الدفع", "Payment terms")}: {quotation.payment_terms}</span>}
            {quotation.delivery_terms && <span>{tr("التسليم", "Delivery")}: {quotation.delivery_terms}</span>}
          </div>
          <div className="mt-2 space-y-1">{quotation.lines.map((line, index) => (
            <div key={line.rfq_item_id || index} className="flex flex-wrap justify-between gap-2 rounded bg-muted/50 px-2 py-1 text-xs">
              <span>{line.product_name}</span>
              <span>{line.quantity} {line.unit} × {fmtEGP(line.unit_price)} · {line.availability === "available" ? tr("متاح", "Available") : tr("غير متاح", "Unavailable")}</span>
            </div>
          ))}</div>
          {!!quotation.attachments.length && <div className="mt-2 flex flex-wrap gap-2">{quotation.attachments.map((attachment) => (
            <QuotationAttachmentLink key={attachment.id} rfqId={rfq?.id} quotationId={quotation.id} attachment={attachment} />
          ))}</div>}
        </div>
      ))}</div>
    </section> : <EmptyState compact title={tr("لا توجد عروض موردين", "No supplier quotations")} />}</TabsContent>

    <TabsContent value="comparison" forceMount className="data-[state=inactive]:hidden"><section className="rounded-lg border bg-card p-3" data-testid="review-workspace-comparison">
      <h4 className="mb-2 text-sm font-bold">{tr("مقارنة الأسعار", "Price comparison")}</h4>
      {!comparison
        ? <div className="text-sm text-muted-foreground">{tr("غير متاح / سجل سابق", "Unavailable / legacy record")}</div>
        : <div className="space-y-3">
          <div className="text-xs text-muted-foreground">{comparison.comparison_number}</div>
          {!!nonCheapestDecisions.length && <div className="space-y-2" data-testid="non-cheapest-decision-context">
            {nonCheapestDecisions.map((decision, index) => (
              <Callout key={decision.item_id || decision.item_code || index} tone="warning" testId="non-cheapest-decision-item">
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-foreground">
                  <span>⚠ {tr("مورد غير الأرخص", "Non-cheapest supplier selected")}</span>
                  {decision.product_name && <span className="font-normal text-muted-foreground">— {decision.product_name}</span>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {tr("السبب", "Reason")}: <b className="text-foreground">{nonCheapestReasonLabel(decision.reason_code, language)}</b>
                  {decision.reason_text && <> — {decision.reason_text}</>}
                </div>
                <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px]">
                  <div><div className="text-muted-foreground">{tr("المختار", "Selected")}</div><b>{decision.selected_supplier_name} — {fmtEGP(decision.selected_total)}</b></div>
                  <div><div className="text-muted-foreground">{tr("الأرخص الصالح", "Cheapest valid")}</div><b>{decision.cheapest_supplier_name} — {fmtEGP(decision.cheapest_total)}</b></div>
                  <div><div className="text-muted-foreground">{tr("الفرق", "Difference")}</div><b className="text-amber-700 dark:text-amber-400" dir="ltr">+{fmtEGP(decision.difference)} ({formatPriceChangePercent(decision.difference_pct) || "-"})</b></div>
                </div>
              </Callout>
            ))}
          </div>}
          {comparison.product_summaries.map((product) => {
            const key = product.item_id || product.item_code;
            const productRows = comparison.rows.filter((row) => (row.item_id || row.item_code) === key);
            return <div key={key} className="rounded-lg border p-3">
              <div className="mb-2 font-bold">{product.product_name}</div>
              <div className="space-y-1">{productRows.map((row, index) => (
                <div
                  key={row.id || index}
                  data-testid="review-workspace-comparison-row"
                  className={`flex flex-wrap items-center justify-between gap-2 rounded px-2 py-1 text-xs ${row.selected_for_purchase ? "bg-emerald-50 ring-1 ring-emerald-300" : "bg-muted/50"}`}
                >
                  <span className="font-bold">{row.supplier_name}{row.selected_for_purchase ? tr(" ✓ محدد للشراء", " ✓ Selected") : ""}</span>
                  <span>{row.quantity} × {fmtEGP(row.unit_price)}{row.discount_pct ? ` − ${row.discount_pct}%` : ""}{row.tax_pct ? ` + ${tr("ضريبة", "VAT")} ${row.tax_pct}%` : ""} = {fmtEGP(row.final_total)}</span>
                  <span>{row.availability === "available" ? tr("متاح", "Available") : tr("غير متاح", "Unavailable")}{row.price_valid_until && ` · ${tr("صالح حتى", "Valid until")} ${row.price_valid_until}`}</span>
                </div>
              ))}</div>
            </div>;
          })}
        </div>}
    </section></TabsContent>
    <TabsContent value="history" forceMount className="data-[state=inactive]:hidden"><section className="rounded-lg border bg-card p-3"><h4 className="mb-3 text-sm font-bold">{tr("سجل النشاط", "Activity history")}</h4><Timeline events={timeline} /></section></TabsContent>
  </Tabs>;
}
