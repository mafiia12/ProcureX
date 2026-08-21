import { useCallback, useEffect, useState } from "react";
import {
  Bell, CheckCircle2, ClipboardList, Download, FileText, Filter,
  Mail, MessageCircle, Phone, RefreshCw, Search, UserPlus,
  ScanText,
  FolderKanban, PlusCircle,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { internalRequestApi, requestError } from "@/lib/requestApi";
import { PRIORITY_OPTIONS } from "@/lib/requestValidation";
import { internalDocumentApi } from "@/lib/documentCaptureApi";
import api, { errMsg } from "@/lib/api";
import ProcurementProgress from "@/components/ProcurementProgress";
import { EmptyState, PageHeader } from "@/components/procurement-ui";
import { useAuth } from "@/contexts/AuthContext";
import { usePreferences } from "@/contexts/PreferencesContext";

export const REQUEST_STATUSES = [
  ["new", "جديد", "New"],
  ["under_review", "قيد المراجعة", "Under review"],
  ["need_clarification", "يحتاج توضيح", "Needs clarification"],
  ["hold", "معلّق", "On hold"],
  ["pricing", "التسعير", "Pricing"],
  ["waiting_for_approval", "بانتظار الموافقة", "Pending approval"],
  ["approved", "معتمد", "Approved"],
  ["rejected", "مرفوض", "Rejected"],
  ["converted_to_purchase", "محوّل إلى شراء", "Converted to purchase"],
  ["completed", "مكتمل", "Completed"],
  ["cancelled", "ملغي", "Cancelled"],
];

const statusLabel = (value, language = "ar") => REQUEST_STATUSES.find(([code]) => code === value)?.[language === "en" ? 2 : 1] || value;
const priorityEnglish = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
const priorityLabel = (value, language = "ar") => language === "en" ? (priorityEnglish[value] || value) : (PRIORITY_OPTIONS.find((option) => option.value === value)?.label || value);
const statusStyle = (status) => ({
  new: "bg-blue-100 text-blue-800",
  under_review: "bg-cyan-100 text-cyan-800",
  need_clarification: "bg-amber-100 text-amber-800",
  hold: "bg-slate-200 text-slate-800",
  pricing: "bg-violet-100 text-violet-800",
  waiting_for_approval: "bg-orange-100 text-orange-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  converted_to_purchase: "bg-indigo-100 text-indigo-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-slate-200 text-slate-700",
}[status] || "bg-slate-100 text-slate-700");

const workflowStage = (status) => ({
  new: 0, under_review: 1, need_clarification: 1, hold: 1,
  pricing: 2, waiting_for_approval: 3, approved: 4,
  converted_to_purchase: 6, completed: 9,
}[status] ?? 0);

const nextActionLabel = (status, tr) => tr(({
  new: "بدء المراجعة الفنية", under_review: "اتخاذ قرار المراجعة الفنية",
  need_clarification: "استلام التوضيح المطلوب ومراجعته", hold: "معالجة سبب التعليق",
  pricing: "استكمال عروض الموردين والمقارنة", waiting_for_approval: "قرار جهة الاعتماد",
  approved: "استكمال الاعتماد التجاري والصرف", converted_to_purchase: "متابعة التوريد والاستلام",
  completed: "لا يوجد إجراء تالٍ",
}[status] || "مراجعة حالة الطلب"), ({
  new: "Start technical review", under_review: "Record the technical review decision",
  need_clarification: "Review the submitted clarification", hold: "Resolve the hold reason",
  pricing: "Complete supplier quotations and comparison", waiting_for_approval: "Approval decision",
  approved: "Complete commercial approval and funds release", converted_to_purchase: "Track delivery and receiving",
  completed: "No next action",
}[status] || "Review request status"));

const Info = ({ label, value }) => (
  <div className="min-w-0 rounded-md bg-muted/50 px-3 py-2">
    <div className="text-[11px] text-muted-foreground">{label}</div>
    <div className="mt-0.5 break-words text-sm font-medium text-foreground">{value || "-"}</div>
  </div>
);

export default function IncomingPurchaseRequests() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { tr, language, direction, locale } = usePreferences();
  const role = user?.role || "";
  const canReviewTechnical = role === "admin" || role === "procurement_engineer";
  const canConvertManualItem = role === "admin" || role === "procurement_responsible";
  const canManageRFQ = role === "admin" || role === "procurement_responsible";

  const [requests, setRequests] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [token, setToken] = useState("");
  const [filters, setFilters] = useState({ search: "", status: "", priority: "" });
  const [assignment, setAssignment] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [note, setNote] = useState("");
  const [author, setAuthor] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [documents, setDocuments] = useState([]);
  const [itemReviewDrafts, setItemReviewDrafts] = useState({});
  const [projectMode, setProjectMode] = useState("");
  const [projects, setProjects] = useState([]);
  const [projectSuggestions, setProjectSuggestions] = useState([]);
  const [projectChoice, setProjectChoice] = useState("");
  const [projectDraft, setProjectDraft] = useState({ name: "", customer_name: "", governorate: "", city: "", address: "", engineer: "", notes: "" });
  const [convertTarget, setConvertTarget] = useState(null);
  const [convertForm, setConvertForm] = useState({
    name: "", unit: "", main_category: "", subcategory: "", brand: "", specifications: "", notes: "",
  });
  const [converting, setConverting] = useState(false);
  const [rfq, setRfq] = useState(null);
  const [creatingRfq, setCreatingRfq] = useState(false);
  const [progressConfirmOpen, setProgressConfirmOpen] = useState(false);

  const openConvert = (item) => {
    setConvertTarget(item);
    setConvertForm({
      name: item.product_name || "", unit: item.unit || "",
      main_category: item.main_category || "", subcategory: item.subcategory || "",
      brand: item.preferred_brand || "", specifications: item.specifications || "", notes: "",
    });
  };

  const submitConvert = async () => {
    if (!convertTarget) return;
    if (!convertForm.name.trim() || !convertForm.unit.trim()) {
      toast.error("اسم الصنف والوحدة مطلوبان");
      return;
    }
    setConverting(true);
    try {
      const { data } = await api.post(
        `/internal/incoming-purchase-requests/${selected.id}/items/${convertTarget.id}/convert-to-item`,
        convertForm,
      );
      toast.success(
        data.created
          ? `تم إنشاء الصنف وربطه بالطلب — ${data.item_code}`
          : `تم ربطه بالصنف ${data.item_code}`,
      );
      setConvertTarget(null);
      await loadDetail(selected.id);
    } catch (error) {
      const detail = error?.response?.data?.detail;
      if (detail && typeof detail === "object" && detail.code === "duplicate_item_name") {
        toast.error(`${detail.message}: ${detail.existing_item.name} (${detail.existing_item.code})`);
      } else {
        toast.error(errMsg(error));
      }
    } finally {
      setConverting(false);
    }
  };

  const loadList = useCallback(async (nextFilters = filters) => {
    setLoading(true);
    try {
      const [listResponse, notificationResponse] = await Promise.all([
        internalRequestApi.get("", { params: nextFilters }),
        internalRequestApi.get("/notifications/unread-count"),
      ]);
      setRequests(listResponse.data);
      setUnreadCount(notificationResponse.data.count);
      setLocked(false);
    } catch (error) {
      if ([401, 403].includes(error?.response?.status)) setLocked(true);
      else toast.error(requestError(error));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { loadList(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDetail = async (requestId) => {
    try {
      const [{ data }, documentResponse] = await Promise.all([
        internalRequestApi.get(`/${requestId}`),
        internalDocumentApi.get(`/${requestId}/documents`),
      ]);
      setSelected(data);
      setDocuments(documentResponse.data);
      setAssignment(data.assigned_employee || "");
    } catch (error) { toast.error(requestError(error)); }
  };
  useEffect(() => {
    if (location.state?.request_id) loadDetail(location.state.request_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state?.request_id]);

  const unlock = async (event) => {
    event.preventDefault();
    window.sessionStorage.setItem("incoming_request_internal_token", token.trim());
    await loadList();
  };

  const saveAssignment = async () => {
    try {
      await internalRequestApi.patch(`/${selected.id}/assignment`, { employee: assignment });
      toast.success("تم تحديث الموظف المسؤول");
      await Promise.all([loadDetail(selected.id), loadList()]);
    } catch (error) { toast.error(requestError(error)); }
  };

  const technicalDecision = async (decision) => {
    if (decision === "revision_required" && !statusNote.trim()) {
      toast.error(tr("اكتب سبب طلب التوضيح أولًا", "Enter the clarification reason first"));
      return;
    }
    try {
      await api.post(`/workflow/incoming-purchase-requests/${selected.id}/technical-decision`, {
        decision, actor: author, note: statusNote,
      });
      setStatusNote("");
      toast.success(tr("تم تسجيل قرار المراجعة الفنية", "Technical review decision recorded"));
      await Promise.all([loadDetail(selected.id), loadList()]);
    } catch (error) { toast.error(errMsg(error)); }
  };
  const approvedItemCount = (selected?.items || []).filter(
    (item) => item.review_status === "approved",
  ).length;
  const returnedItemCount = (selected?.items || []).filter(
    (item) => ["rejected", "need_clarification"].includes(item.review_status),
  ).length;
  const pendingItemCount = Math.max(
    (selected?.items || []).length - approvedItemCount - returnedItemCount,
    0,
  );
  const confirmEligibleProgression = async () => {
    setProgressConfirmOpen(false);
    await technicalDecision("approved_for_pricing");
  };
  const openProjectFlow = async (mode) => {
    try {
      const [projectResponse, suggestionResponse] = await Promise.all([
        api.get("/projects"),
        api.get(`/workflow/incoming-purchase-requests/${selected.id}/project-suggestions`),
      ]);
      setProjects(projectResponse.data);
      setProjectSuggestions(suggestionResponse.data.suggestions || []);
      setProjectMode(mode);
      setProjectChoice(suggestionResponse.data.suggestions?.[0]?.id || "");
      setProjectDraft({ name: selected.project_name || "", customer_name: selected.customer_name || selected.company_name || "", governorate: "", city: selected.project_location || "", address: selected.delivery_location || "", engineer: selected.requester_name || "", notes: `تم الإنشاء من طلب الشراء ${selected.request_number}` });
    } catch (error) { toast.error(errMsg(error)); }
  };
  const linkProject = async (projectId = projectChoice) => {
    if (!projectId) return toast.error("اختر المشروع أولاً");
    try {
      await api.post(`/workflow/incoming-purchase-requests/${selected.id}/link-project`, { project_id: projectId, actor: author });
      toast.success("تم ربط الطلب بالمشروع"); setProjectMode(""); await Promise.all([loadDetail(selected.id), loadList()]);
    } catch (error) { toast.error(errMsg(error)); }
  };
  const createAndLinkProject = async (confirmSimilar = false) => {
    if (!projectDraft.name.trim()) return toast.error("اسم المشروع مطلوب");
    try {
      await api.post(`/workflow/incoming-purchase-requests/${selected.id}/create-project`, { ...projectDraft, actor: author, confirm_similar: confirmSimilar });
      toast.success("تم إنشاء وربط المشروع"); setProjectMode(""); await Promise.all([loadDetail(selected.id), loadList()]);
    } catch (error) {
      const detail = error?.response?.data?.detail;
      if (error?.response?.status === 409 && detail?.suggestions?.length) {
        setProjectSuggestions(detail.suggestions); setProjectMode("similar");
      } else toast.error(errMsg(error));
    }
  };
  useEffect(() => {
    if (!selected?.id) { setRfq(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const response = await api.get(`/workflow/rfqs/by-request/${selected.id}`);
        if (!cancelled) setRfq(response.data);
      } catch (error) {
        if (!cancelled) setRfq(null);
      }
    })();
    return () => { cancelled = true; };
  }, [selected?.id]);

  const createOrOpenRfq = async () => {
    if (!selected) return;
    setCreatingRfq(true);
    try {
      const { data } = await api.post("/workflow/rfqs", {
        source_request_id: selected.id, actor: author,
      });
      navigate(`/rfq/${data.rfq.id}`);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setCreatingRfq(false);
    }
  };

  const sendToComparison = () => {
  if (!selected) return;
  if (selected.status !== "pricing") return toast.error("اعتماد مهندس المشتريات مطلوب أولاً");
  if (!selected.project_id) return toast.error("اربط الطلب بمشروع قبل بدء المقارنة");

  navigate("/supplier-price-comparison", {
    state: {
      sourceRequest: {
        request_id: selected.id,
        request_number: selected.request_number,
        project_name: selected.project_name,
        requester_name: selected.requester_name,
        company_name: selected.company_name,
        items: selected.items,
      },
    },
  });
};
    const saveItemReview = async (item) => {
    const draft = itemReviewDrafts[item.id] || {
      status: item.review_status || "pending",
      reason: item.review_reason || "",
    };

    if (
      ["rejected", "need_clarification"].includes(draft.status)
      && !draft.reason.trim()
    ) {
      toast.error("سبب الرفض أو طلب الاستكمال مطلوب");
      return;
    }

    try {
      // This endpoint requires a real ERP session (require_erp_role), not
      // the legacy internal-access token internalRequestApi sends - it must
      // go through the authenticated `api` client so the JWT is attached.
      await api.patch(
        `/internal/incoming-purchase-requests/${selected.id}/items/${item.id}/review`,
        {
          status: draft.status,
          reason: draft.reason,
          reviewed_by: author,
        },
      );

      toast.success("تم تحديث حالة الصنف");
      await loadDetail(selected.id);
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    try {
      await internalRequestApi.post(`/${selected.id}/notes`, { author, note });
      setNote("");
      toast.success("تمت إضافة الملاحظة الداخلية");
      await loadDetail(selected.id);
    } catch (error) { toast.error(requestError(error)); }
  };

  const convertCustomer = async () => {
    try {
      const { data } = await internalRequestApi.post(`/${selected.id}/convert-customer`);
      toast.success(data.created ? `تم إنشاء العميل ${data.customer_code}` : `العميل مرتبط بالفعل ${data.customer_code}`);
      await loadDetail(selected.id);
    } catch (error) { toast.error(requestError(error)); }
  };

  const convertDocument = async (documentType) => {
    try {
      const { data } = await internalRequestApi.post(`/${selected.id}/convert`, {
        document_type: documentType, converted_by: author,
      });
      toast.success(`تم إنشاء المستند المبدئي ${data.document_number}`);
      await Promise.all([loadDetail(selected.id), loadList()]);
    } catch (error) { toast.error(requestError(error)); }
  };

  const openAttachment = async (item) => {
    const popup = window.open("", "_blank", "noopener,noreferrer");
    try {
      const response = await internalRequestApi.get(
        `/${selected.id}/attachments/${item.attachment.id}`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(response.data);
      if (popup) popup.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      if (popup) popup.close();
      toast.error(requestError(error));
    }
  };

  if (locked) {
    return (
      <div className="mx-auto max-w-md rounded-lg border bg-card p-6 shadow-sm" data-testid="incoming-requests-access">
        <h2 className="text-lg font-bold text-foreground">{tr("دخول الطلبات الواردة", "Incoming requests access")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{tr("أدخل رمز الوصول الداخلي المخصص لهذه البيئة.", "Enter the internal access token for this environment.")}</p>
        <form onSubmit={unlock} className="mt-4 space-y-3">
          <Input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="current-password" />
          <Button type="submit" className="w-full">{tr("دخول", "Continue")}</Button>
        </form>
      </div>
    );
  }

  const latestClarification = selected?.status_history
    ?.slice()
    .reverse()
    .find((entry) => entry.to_status === "need_clarification");

  return (
    <div className="space-y-4" data-testid="incoming-purchase-requests-page">
      <PageHeader
        title={tr("طلبات الشراء الواردة", "Incoming Purchase Requests")}
        description={tr("راجع الطلب وحدد الإجراء التالي بأقل تمرير ممكن.", "Review each request and identify its next action with minimal scrolling.")}
        actions={<div className="flex items-center gap-2">
          <Badge className="gap-1 bg-destructive/10 text-destructive hover:bg-destructive/10"><Bell className="h-3.5 w-3.5" /> {tr(`${unreadCount} جديد`, `${unreadCount} new`)}</Badge>
          <Button variant="outline" size="sm" onClick={() => loadList()}><RefreshCw className="ms-1 h-4 w-4" />{tr("تحديث", "Refresh")}</Button>
        </div>}
      />

      <div className="rounded-lg border bg-card p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(220px,1fr)_180px_160px_auto]">
          <div className="relative">
            <Search className="absolute start-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="ps-9" placeholder={tr("بحث بالرقم أو الاسم أو الهاتف أو المشروع", "Search number, requester, phone, or project")} value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} />
          </div>
          <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
            <option value="">{tr("كل الحالات", "All statuses")}</option>
            {REQUEST_STATUSES.map(([value, ar, en]) => <option key={value} value={value}>{language === "en" ? en : ar}</option>)}
          </select>
          <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={filters.priority} onChange={(event) => setFilters((current) => ({ ...current, priority: event.target.value }))}>
            <option value="">{tr("كل الأولويات", "All priorities")}</option>
            {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{priorityLabel(option.value, language)}</option>)}
          </select>
          <Button size="sm" className="h-9" onClick={() => loadList(filters)}><Filter className="ms-1 h-4 w-4" />{tr("تطبيق", "Apply")}</Button>
        </div>
      </div>

      <div className="grid min-h-[560px] grid-cols-1 gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.5fr)]">
        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="border-b px-4 py-3 text-sm font-bold text-foreground">{tr(`الطلبات (${requests.length})`, `Requests (${requests.length})`)}</div>
          <div className="max-h-[690px] divide-y divide-border overflow-y-auto">
            {loading && <div className="p-8 text-center text-sm text-muted-foreground">{tr("جارٍ التحميل...", "Loading...")}</div>}
            {!loading && !requests.length && <EmptyState icon={ClipboardList} title={tr("لا توجد طلبات مطابقة", "No matching requests")} description={tr("غيّر عوامل البحث أو انتظر وصول طلب شراء جديد من الموقع.", "Adjust the filters or wait for a new site request.")} className="border-0 py-8" />}
            {requests.map((request) => (
              <button key={request.id} type="button" onClick={() => loadDetail(request.id)} className={`block w-full px-4 py-3 text-start transition-colors hover:bg-muted/50 ${selected?.id === request.id ? "bg-primary/5" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-foreground" dir="ltr">{request.request_number}</div>
                    <div className="mt-1 truncate text-sm text-foreground">{request.requester_name} — {request.project_name}</div>
                  </div>
                  <Badge className={`${statusStyle(request.status)} hover:opacity-90`}>{statusLabel(request.status, language)}</Badge>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <span>{tr(`${request.item_count} صنف`, `${request.item_count} items`)}</span>
                  <span className="text-center">{priorityLabel(request.priority, language)}</span>
                  <span className="text-end">{request.required_delivery_date || new Date(request.created_at).toLocaleDateString(locale)}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-4">
          {!selected ? (
            <div className="flex min-h-[520px] flex-col items-center justify-center text-center text-muted-foreground">
              <ClipboardList className="h-12 w-12" />
              <p className="mt-3 text-sm">{tr("اختر طلباً لعرض التفاصيل والإجراءات.", "Select a request to view details and actions.")}</p>
            </div>
          ) : (
            <div className="space-y-5" data-testid="incoming-request-detail">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
                <div>
                  <div className="text-lg font-bold text-foreground" dir="ltr">{selected.request_number}</div>
                  <div className="text-xs text-muted-foreground">{tr("تم الاستلام", "Received")} {new Date(selected.created_at).toLocaleString(locale)}</div>
                </div>
                <Badge className={statusStyle(selected.status)}>{statusLabel(selected.status, language)}</Badge>
              </div>

              <ProcurementProgress currentStage={workflowStage(selected.status)} />

              <div className="grid gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 sm:grid-cols-2">
                <div><div className="text-[11px] text-muted-foreground">{tr("المرحلة الحالية", "Current stage")}</div><div className="mt-1 text-sm font-semibold text-foreground">{statusLabel(selected.status, language)}</div></div>
                <div><div className="text-[11px] text-muted-foreground">{tr("الإجراء التالي المطلوب", "Next required action")}</div><div className="mt-1 text-sm font-semibold text-primary">{nextActionLabel(selected.status, tr)}</div></div>
              </div>

              {selected.status === "need_clarification" && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4" data-testid="clarification-summary">
                  <div className="font-semibold text-amber-950">{tr("الطلب يحتاج توضيحًا", "Request needs clarification")}</div>
                  <div className="mt-2 grid gap-2 text-sm text-amber-900 sm:grid-cols-3">
                    <div><span className="text-xs text-amber-700">{tr("السبب", "Reason")}</span><div>{latestClarification?.note || tr("لم يُسجّل سبب تفصيلي", "No detailed reason recorded")}</div></div>
                    <div><span className="text-xs text-amber-700">{tr("طلبه", "Requested by")}</span><div>{latestClarification?.changed_by || tr("غير محدد", "Not specified")}</div></div>
                    <div><span className="text-xs text-amber-700">{tr("التاريخ / الاستجابة", "Date / response")}</span><div>{latestClarification?.created_at ? new Date(latestClarification.created_at).toLocaleString(locale) : "-"} · {tr("بانتظار الرد", "Awaiting response")}</div></div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                <Info label={tr("مقدم الطلب", "Requester")} value={selected.requester_name} />
                <Info label={tr("الشركة", "Company")} value={selected.company_name} />
                <Info label={tr("الهاتف", "Phone")} value={selected.phone_number} />
                <Info label={tr("المشروع", "Project")} value={selected.project_name} />
                <Info label={tr("موقع المشروع", "Project location")} value={selected.project_location} />
                <Info label={tr("مكان التسليم", "Delivery location")} value={selected.delivery_location} />
                <Info label={tr("التسليم المطلوب", "Required date")} value={selected.required_delivery_date} />
                <Info label={tr("الأولوية", "Priority")} value={priorityLabel(selected.priority, language)} />
                <Info label={tr("الموظف المسؤول", "Assigned employee")} value={selected.assigned_employee} />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm"><a href={`tel:${selected.phone_number}`}><Phone className="ms-1 h-4 w-4" />{tr("اتصال", "Call")}</a></Button>
                {selected.whatsapp_number && <Button asChild variant="outline" size="sm"><a href={`https://wa.me/${selected.whatsapp_number.replace(/\D/g, "")}`} target="_blank" rel="noreferrer"><MessageCircle className="ms-1 h-4 w-4" />WhatsApp</a></Button>}
                {selected.email && <Button asChild variant="outline" size="sm"><a href={`mailto:${selected.email}`}><Mail className="ms-1 h-4 w-4" />{tr("بريد إلكتروني", "Email")}</a></Button>}
              </div>

              {selected.project_id ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="rounded-lg bg-emerald-700 p-2 text-white"><FolderKanban className="h-5 w-5" /></div><div><div className="text-xs font-bold text-emerald-700 dark:text-emerald-300">{tr("المشروع مربوط", "Project linked")}</div><div className="font-bold text-foreground">{selected.project_name}</div></div></div><Button type="button" onClick={() => navigate(`/projects/${selected.project_id}/purchases`)}>{tr("فتح مركز المشروع", "Open project center")}</Button></div></div> : <div className="rounded-xl border-2 border-amber-500/40 bg-amber-500/10 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-lg font-bold text-foreground">{tr("المشروع غير مربوط", "Project not linked")}</div><p className="mt-1 text-sm text-amber-800 dark:text-amber-300">{tr("اربط الطلب قبل متابعة المقارنة حتى تنتقل البيانات تلقائيًا.", "Link the request before comparison so workflow data carries forward correctly.")}</p></div><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => openProjectFlow("link")}><FolderKanban className="h-4 w-4" />{tr("ربط بمشروع موجود", "Link existing project")}</Button><Button type="button" onClick={() => openProjectFlow("create")}><PlusCircle className="h-4 w-4" />{tr("إضافة مشروع جديد", "Add new project")}</Button></div></div></div>}

              {!!projectMode && <div className="rounded-xl border-2 border-blue-500/30 bg-card p-4 shadow-sm"><div className="flex items-center justify-between"><h3 className="font-bold">{projectMode === "link" ? tr("ربط بمشروع موجود", "Link existing project") : projectMode === "similar" ? tr("وجدنا مشروعًا مشابهًا", "A similar project was found") : tr("إنشاء وربط المشروع", "Create and link project")}</h3><Button variant="ghost" size="sm" onClick={() => setProjectMode("")}>{tr("إغلاق", "Close")}</Button></div>{projectSuggestions.length > 0 && <div className="mt-3 rounded-lg bg-blue-500/10 p-3"><div className="mb-2 text-sm font-bold">{tr("مشروعات مقترحة — لن يتم الربط تلقائيًا", "Suggested projects — nothing is linked automatically")}</div><div className="space-y-2">{projectSuggestions.map((project) => <div key={project.id} className="flex items-center justify-between rounded-lg bg-card p-3"><div><b>{project.name}</b><div className="text-xs text-muted-foreground">{project.customer_name || "-"} · {[project.governorate, project.city].filter(Boolean).join(" - ") || tr("بدون موقع", "No location")}</div></div><Button size="sm" variant="outline" onClick={() => linkProject(project.id)}>{tr("ربط بالموجود", "Link project")}</Button></div>)}</div></div>}{projectMode === "link" && <div className="mt-3 flex gap-2"><select className="h-10 flex-1 rounded-md border bg-background px-3" value={projectChoice} onChange={(event) => setProjectChoice(event.target.value)}><option value="">{tr("اختر المشروع", "Select project")}</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code} — {project.name}</option>)}</select><Button onClick={() => linkProject()}>{tr("ربط بالموجود", "Link project")}</Button></div>}{["create", "similar"].includes(projectMode) && <div className="mt-3 grid gap-2 md:grid-cols-2"><Input value={projectDraft.name} onChange={(e) => setProjectDraft((x) => ({ ...x, name: e.target.value }))} placeholder={tr("اسم المشروع *", "Project name *")} /><Input value={projectDraft.customer_name} onChange={(e) => setProjectDraft((x) => ({ ...x, customer_name: e.target.value }))} placeholder={tr("العميل", "Client")} /><Input value={projectDraft.governorate} onChange={(e) => setProjectDraft((x) => ({ ...x, governorate: e.target.value }))} placeholder={tr("المحافظة", "Governorate")} /><Input value={projectDraft.city} onChange={(e) => setProjectDraft((x) => ({ ...x, city: e.target.value }))} placeholder={tr("المدينة / الموقع", "City / location")} /><Input value={projectDraft.address} onChange={(e) => setProjectDraft((x) => ({ ...x, address: e.target.value }))} placeholder={tr("العنوان", "Address")} /><Input value={projectDraft.engineer} onChange={(e) => setProjectDraft((x) => ({ ...x, engineer: e.target.value }))} placeholder={tr("المهندس / المسؤول", "Engineer / owner")} /><Textarea className="md:col-span-2" value={projectDraft.notes} onChange={(e) => setProjectDraft((x) => ({ ...x, notes: e.target.value }))} placeholder={tr("ملاحظات", "Notes")} /><div className="flex justify-end md:col-span-2"><Button onClick={() => createAndLinkProject(projectMode === "similar")}>{tr("إنشاء وربط المشروع", "Create and link project")}</Button></div></div>}</div>}

              <div>
                <h3 className="mb-2 text-sm font-bold text-foreground">{tr("الأصناف المطلوبة", "Requested items")}</h3>
                <div className="space-y-2">
                  {selected.items.map((item) => (
                    <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-800 flex items-center gap-1.5">
                            {item.position}. {item.product_name}
                            {!item.item_id && (
                              <>
                                <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300">
                                  {tr("صنف يدوي", "Manual item")}
                                </Badge>
                                {canConvertManualItem && (
                                  <Button
                                    variant="outline" size="sm" className="h-6 px-2 text-[11px]"
                                    data-testid="convert-manual-item-button"
                                    onClick={() => openConvert(item)}
                                  >
                                    {tr("إضافة إلى الأصناف", "Add to Item Master")}
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">{[item.main_category, item.subcategory, item.preferred_brand].filter(Boolean).join(" / ") || tr("بدون تصنيف أو علامة مفضلة", "No category or preferred brand")}</div>
                        </div>
                        <div className="whitespace-nowrap rounded-md bg-blue-50 px-2 py-1 text-sm font-bold text-primary">{item.quantity} {item.unit}</div>
                      </div>
                      {item.specifications && <p className="mt-2 text-sm leading-5 text-muted-foreground">{item.specifications}</p>}
                      <div className="mt-3 grid gap-2 rounded-md bg-muted/50 p-3 md:grid-cols-[180px_1fr_auto]">
                        <select
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={
                            itemReviewDrafts[item.id]?.status
                            ?? item.review_status
                            ?? "pending"
                          }
                          onChange={(event) =>
                            setItemReviewDrafts((current) => ({
                              ...current,
                              [item.id]: {
                                status: event.target.value,
                                reason:
                                  current[item.id]?.reason
                                  ?? item.review_reason
                                  ?? "",
                              },
                            }))
                          }
                        >
                          <option value="pending">{tr("قيد المراجعة", "Under review")}</option>
                          <option value="approved">{tr("معتمد", "Approved")}</option>
                          <option value="rejected">{tr("مرفوض", "Rejected")}</option>
                          <option value="need_clarification">{tr("يحتاج استكمال", "Needs clarification")}</option>
                          <option value="hold">{tr("معلّق", "On hold")}</option>
                        </select>

                        <Input
                          value={
                            itemReviewDrafts[item.id]?.reason
                            ?? item.review_reason
                            ?? ""
                          }
                          onChange={(event) =>
                            setItemReviewDrafts((current) => ({
                              ...current,
                              [item.id]: {
                                status:
                                  current[item.id]?.status
                                  ?? item.review_status
                                  ?? "pending",
                                reason: event.target.value,
                              },
                            }))
                          }
                          placeholder={tr("سبب الرفض أو طلب الاستكمال", "Reason for rejection or clarification")}
                        />

                        <Button
                          type="button"
                          size="sm"
                          onClick={() => saveItemReview(item)}
                        >
                          {tr("حفظ حالة الصنف", "Save item review")}
                        </Button>
                      </div>
                      {item.attachment && <Button variant="ghost" size="sm" className="mt-2 h-7 gap-1 px-2 text-primary" onClick={() => openAttachment(item)}><Download className="h-3.5 w-3.5" /> {item.attachment.original_filename}</Button>}
                    </div>
                  ))}
                </div>
              </div>

              {!!documents.length && <div>
                <h3 className="mb-2 text-sm font-bold text-foreground">{tr("المستندات المرفوعة للمراجعة", "Documents submitted for review")}</h3>
                <div className="space-y-2">{documents.map((document) => <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><div className="text-sm font-bold">{document.document_type}</div><div className="mt-1 text-xs text-muted-foreground">{document.status} · {document.page_count || 0} {tr("صفحة", "pages")}</div></div><Button asChild size="sm" variant="outline"><Link to={`/incoming-requests/${selected.id}/documents/${document.id}/review`}><ScanText className="ms-1 h-4 w-4" /> {tr("مراجعة الاستخراج", "Review extraction")}</Link></Button></div>)}</div>
              </div>}

              {selected.notes && <div><h3 className="mb-1 text-sm font-bold text-foreground">{tr("ملاحظات مقدم الطلب", "Requester notes")}</h3><p className="rounded-md bg-muted/60 p-3 text-sm leading-6 text-muted-foreground">{selected.notes}</p></div>}

              <div className="grid grid-cols-1 gap-3 border-t border-slate-200 pt-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs">{tr("الموظف المسؤول", "Assigned employee")}</Label>
                  <div className="flex gap-2"><Input value={assignment} onChange={(event) => setAssignment(event.target.value)} placeholder={tr("اسم الموظف", "Employee name")} /><Button variant="outline" onClick={saveAssignment}>{tr("حفظ", "Save")}</Button></div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">{tr("اسم منفذ الإجراء", "Action owner")}</Label>
                  <Input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder={tr("اسم الموظف", "Employee name")} />
                </div>
                {selected.status === "pricing" ? <div className="rounded-lg border bg-emerald-500/10 p-4 lg:col-span-2" data-testid="technical-review-complete"><div className="flex items-center gap-3"><CheckCircle2 className="h-8 w-8 text-emerald-700" /><div><h3 className="font-bold text-emerald-950">{tr("تمت المراجعة الفنية", "Technical review completed")}</h3><p className="text-sm text-emerald-800">{tr("جاهز للتسعير والمقارنة", "Ready for pricing and comparison")}</p></div></div></div> : ["rejected", "completed", "cancelled"].includes(selected.status) ? <div className="rounded-lg border bg-destructive/10 p-4 text-sm font-bold text-destructive lg:col-span-2">{tr("انتهت المراجعة بحالة", "Review ended with status")}: {statusLabel(selected.status, language)}</div> : canReviewTechnical ? <div className="space-y-3 rounded-lg border bg-blue-500/10 p-4 lg:col-span-2" data-testid="technical-review-actions">
                  <div><div className="text-xs font-bold text-blue-700 dark:text-blue-300">{tr("الإجراء المسؤول: مهندس المشتريات", "Action owner: Procurement Engineer")}</div><h3 className="font-bold text-blue-950 dark:text-blue-100">{tr("قرار المراجعة الفنية لطلب الشراء", "Purchase request technical decision")}</h3></div>
                  <div className="grid gap-2 sm:grid-cols-3" data-testid="partial-review-summary">
                    <Info label={tr("مؤهل للتسعير", "Eligible for sourcing")} value={approvedItemCount} />
                    <Info label={tr("سيعود لمقدم الطلب", "Returned to requester")} value={returnedItemCount} />
                    <Info label={tr("لم يُحسم بعد", "Not decided yet")} value={pendingItemCount} />
                  </div>
                  <Input value={statusNote} onChange={(event) => setStatusNote(event.target.value)} placeholder={tr("ملاحظة القرار (اختياري)", "Decision note (optional)")} />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => setProgressConfirmOpen(true)}
                      disabled={approvedItemCount === 0}
                      className="bg-emerald-700 text-white hover:bg-emerald-800"
                      data-testid="approve-eligible-items"
                    >{tr("اعتماد الأصناف المؤهلة للتسعير", "Approve eligible items for sourcing")}</Button>
                    <Button variant="outline" onClick={() => technicalDecision("hold")}>{tr("تعليق", "Place on hold")}</Button>
                    <Button variant="destructive" onClick={() => technicalDecision("rejected")}>{tr("رفض", "Reject")}</Button>
                  </div>
                </div> : null}
                <div className="space-y-2 lg:col-span-2">
                  <Label className="text-xs">{tr("إضافة ملاحظة داخلية", "Add internal note")}</Label>
                  <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={tr("هذه الملاحظة داخلية ولا تظهر لمقدم الطلب", "This note is internal and is not shown to the requester")} rows={2} />
                  <Button variant="outline" size="sm" onClick={addNote}>{tr("إضافة الملاحظة", "Add note")}</Button>
                </div>
              </div>

              {(rfq || (canManageRFQ && selected.status === "pricing" && selected.project_id)) && (
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-4" data-testid="rfq-panel">
                  {rfq ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold text-violet-700">{tr("طلب تسعير (RFQ)", "Request for Quotation (RFQ)")}</div>
                        <div className="font-bold text-violet-950">{rfq.rfq_number}</div>
                        <div className="mt-1 text-xs text-violet-800">
                          {tr(`${rfq.supplier_count} مورد`, `${rfq.supplier_count} suppliers`)} · {tr(`${rfq.received_quotation_count} عرض مستلم`, `${rfq.received_quotation_count} quotations received`)}
                          {rfq.deadline && <> · {tr("الموعد النهائي", "Deadline")}: {rfq.deadline}</>}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => navigate(`/rfq/${rfq.id}`)} data-testid="open-rfq-button">
                        {tr("فتح RFQ", "Open RFQ")}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm text-violet-900">{tr("لم يُنشأ طلب تسعير لهذا الطلب بعد.", "No RFQ has been created for this request yet.")}</div>
                      <Button size="sm" onClick={createOrOpenRfq} disabled={creatingRfq} data-testid="create-rfq-button">
                        {tr("إنشاء RFQ", "Create RFQ")}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div className="border-t border-slate-200 pt-4">
                <h3 className="mb-2 text-sm font-bold text-foreground">{tr("الإجراءات التالية", "Next actions")}</h3>
                <div className="flex flex-wrap gap-2">

                  <Button
                    variant="default"
                    size="sm"
                    onClick={sendToComparison}
                    disabled={selected.status !== "pricing" || !selected.project_id}
                  >
                    {tr("بدء مقارنة الأسعار", "Start supplier comparison")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={convertCustomer} disabled={Boolean(selected.converted_customer_id)}><UserPlus className="ms-1 h-4 w-4" /> {selected.converted_customer_id ? tr("تم ربط العميل", "Client linked") : tr("تحويل إلى عميل", "Convert to client")}</Button>
                  <Button variant="outline" size="sm" onClick={() => convertDocument("internal_request")} disabled={Boolean(selected.converted_document)}><FileText className="ms-1 h-4 w-4" /> {tr("طلب شراء داخلي", "Internal purchase request")}</Button>
                  <Button variant="outline" size="sm" onClick={() => convertDocument("purchase_draft")} disabled={Boolean(selected.converted_document)}><ClipboardList className="ms-1 h-4 w-4" /> {tr("مسودة شراء", "Purchase draft")}</Button>
                </div>
                {(selected.status !== "pricing" || !selected.project_id) && <p className="mt-2 text-xs text-amber-700">{tr("يتاح بدء المقارنة بعد الاعتماد الفني وربط الطلب بالمشروع.", "Supplier comparison becomes available after technical approval and project linking.")}</p>}
                {selected.converted_document && <div className="mt-2 flex items-center gap-2 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" /> {tr(`تم إنشاء ${selected.converted_document.document_number} كمسودة داخلية، وليس عملية شراء مكتملة.`, `${selected.converted_document.document_number} was created as an internal draft, not a completed purchase.`)}</div>}
              </div>

              <div className="border-t border-slate-200 pt-4">
                <h3 className="mb-2 text-sm font-bold text-foreground">{tr("سجل الحالة", "Status history")}</h3>
                <div className="space-y-2">
                  {[...selected.status_history].reverse().map((entry) => <div key={entry.id} className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground"><b>{statusLabel(entry.to_status, language)}</b> — {new Date(entry.created_at).toLocaleString(locale)} {entry.changed_by && `— ${entry.changed_by}`} {entry.note && <div className="mt-1">{entry.note}</div>}</div>)}
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-bold text-foreground">{tr("الملاحظات الداخلية", "Internal notes")}</h3>
                <div className="space-y-2">{selected.internal_notes.length ? selected.internal_notes.map((entry) => <div key={entry.id} className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-foreground">{entry.note}<div className="mt-1 text-[11px] text-muted-foreground">{entry.author || tr("بدون اسم", "No name")} — {new Date(entry.created_at).toLocaleString(locale)}</div></div>) : <div className="text-xs text-muted-foreground">{tr("لا توجد ملاحظات داخلية.", "No internal notes.")}</div>}</div>
              </div>
            </div>
          )}
        </section>
      </div>

      <Dialog open={!!convertTarget} onOpenChange={(open) => !open && setConvertTarget(null)}>
        <DialogContent dir={direction} className="max-w-lg" data-testid="convert-manual-item-dialog">
          <DialogHeader>
            <DialogTitle className="text-start">{tr("إضافة إلى الأصناف", "Add to Item Master")}</DialogTitle>
            <DialogDescription className="text-start">
              {tr("راجع بيانات الصنف اليدوي قبل إضافته إلى دليل الأصناف. النص الأصلي للطلب يبقى محفوظًا كما هو.", "Review the manual item before adding it to the Item Master. The original request text remains unchanged.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{tr("اسم الصنف", "Item name")}</Label>
              <Input
                data-testid="convert-form-name"
                value={convertForm.name}
                onChange={(e) => setConvertForm({ ...convertForm, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{tr("الوحدة", "Unit")}</Label>
                <Input
                  data-testid="convert-form-unit"
                  value={convertForm.unit}
                  onChange={(e) => setConvertForm({ ...convertForm, unit: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{tr("العلامة التجارية", "Brand")}</Label>
                <Input
                  value={convertForm.brand}
                  onChange={(e) => setConvertForm({ ...convertForm, brand: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{tr("التصنيف الرئيسي", "Main category")}</Label>
                <Input
                  value={convertForm.main_category}
                  onChange={(e) => setConvertForm({ ...convertForm, main_category: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{tr("التصنيف الفرعي", "Subcategory")}</Label>
                <Input
                  value={convertForm.subcategory}
                  onChange={(e) => setConvertForm({ ...convertForm, subcategory: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{tr("المواصفات / الوصف", "Specifications / description")}</Label>
              <Textarea
                rows={3}
                value={convertForm.specifications}
                onChange={(e) => setConvertForm({ ...convertForm, specifications: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConvertTarget(null)}>{tr("إلغاء", "Cancel")}</Button>
            <Button data-testid="convert-form-submit" onClick={submitConvert} disabled={converting}>
              {converting ? tr("جارٍ الإضافة...", "Adding...") : tr("إضافة إلى الأصناف", "Add to Item Master")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={progressConfirmOpen} onOpenChange={setProgressConfirmOpen}>
        <DialogContent dir={direction} className="max-w-md" data-testid="eligible-items-confirmation">
          <DialogHeader>
            <DialogTitle className="text-start">{tr("تأكيد انتقال الأصناف المؤهلة", "Confirm eligible item progression")}</DialogTitle>
            <DialogDescription className="text-start">
              {tr("سيستمر فقط ما تم اعتماده في مسار التسعير. البنود المرتجعة تبقى محفوظة في الطلب الأصلي.", "Only approved items will continue to sourcing. Returned items remain preserved on the original request.")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Info label={tr("ستنتقل للتسعير", "Moving to sourcing")} value={approvedItemCount} />
            <Info label={tr("ستعود لمقدم الطلب", "Returning to requester")} value={returnedItemCount} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setProgressConfirmOpen(false)}>{tr("إلغاء", "Cancel")}</Button>
            <Button onClick={confirmEligibleProgression} data-testid="confirm-eligible-items">{tr("تأكيد الاعتماد للتسعير", "Confirm for sourcing")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
