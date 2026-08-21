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

export const REQUEST_STATUSES = [
  ["new", "جديد"],
  ["under_review", "قيد المراجعة"],
  ["need_clarification", "يحتاج توضيح"],
  ["hold", "معلّق"],
  ["pricing", "التسعير"],
  ["waiting_for_approval", "بانتظار الموافقة"],
  ["approved", "معتمد"],
  ["rejected", "مرفوض"],
  ["converted_to_purchase", "محوّل إلى شراء"],
  ["completed", "مكتمل"],
  ["cancelled", "ملغي"],
];

const statusLabel = (value) => REQUEST_STATUSES.find(([code]) => code === value)?.[1] || value;
const priorityLabel = (value) => PRIORITY_OPTIONS.find((option) => option.value === value)?.label || value;
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

const nextActionLabel = (status) => ({
  new: "بدء المراجعة الفنية",
  under_review: "اتخاذ قرار المراجعة الفنية",
  need_clarification: "استلام التوضيح المطلوب ومراجعته",
  hold: "معالجة سبب التعليق",
  pricing: "استكمال عروض الموردين والمقارنة",
  waiting_for_approval: "قرار جهة الاعتماد",
  approved: "استكمال الاعتماد التجاري والصرف",
  converted_to_purchase: "متابعة التوريد والاستلام",
  completed: "لا يوجد إجراء تالٍ",
}[status] || "مراجعة حالة الطلب");

const Info = ({ label, value }) => (
  <div className="min-w-0 rounded-md bg-slate-50 px-3 py-2">
    <div className="text-[11px] text-slate-500">{label}</div>
    <div className="mt-0.5 break-words text-sm font-medium text-slate-800">{value || "-"}</div>
  </div>
);

export default function IncomingPurchaseRequests() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
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
    try {
      await api.post(`/workflow/incoming-purchase-requests/${selected.id}/technical-decision`, {
        decision, actor: author, note: statusNote,
      });
      setStatusNote("");
      toast.success("تم تسجيل قرار المراجعة الفنية");
      await Promise.all([loadDetail(selected.id), loadList()]);
    } catch (error) { toast.error(errMsg(error)); }
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
      <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="incoming-requests-access">
        <h2 className="text-lg font-bold text-slate-900">دخول الطلبات الواردة</h2>
        <p className="mt-1 text-sm text-slate-500">أدخل رمز الوصول الداخلي المخصص لهذه البيئة.</p>
        <form onSubmit={unlock} className="mt-4 space-y-3">
          <Input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="current-password" />
          <Button type="submit" className="w-full">دخول</Button>
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
        title="طلبات الشراء الواردة"
        description="راجع الطلبات، حدّد الإجراء التالي، وحافظ على وضوح المسار من الطلب حتى أمر الشراء."
        actions={<div className="flex items-center gap-2">
          <Badge className="gap-1 bg-red-100 text-red-700 hover:bg-red-100"><Bell className="h-3.5 w-3.5" /> {unreadCount} جديد</Badge>
          <Button variant="outline" size="sm" onClick={() => loadList()}><RefreshCw className="ms-1 h-4 w-4" /> تحديث</Button>
        </div>}
      />

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(220px,1fr)_180px_160px_auto]">
          <div className="relative">
            <Search className="absolute start-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="ps-9" placeholder="بحث بالرقم أو الاسم أو الهاتف أو المشروع" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} />
          </div>
          <select className="h-9 rounded-md border border-input bg-white px-3 text-sm" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
            <option value="">كل الحالات</option>
            {REQUEST_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select className="h-9 rounded-md border border-input bg-white px-3 text-sm" value={filters.priority} onChange={(event) => setFilters((current) => ({ ...current, priority: event.target.value }))}>
            <option value="">كل الأولويات</option>
            {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <Button size="sm" className="h-9" onClick={() => loadList(filters)}><Filter className="ms-1 h-4 w-4" /> تطبيق</Button>
        </div>
      </div>

      <div className="grid min-h-[560px] grid-cols-1 gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.5fr)]">
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-bold text-slate-700">الطلبات ({requests.length})</div>
          <div className="max-h-[690px] divide-y divide-slate-100 overflow-y-auto">
            {loading && <div className="p-8 text-center text-sm text-slate-500">جارٍ التحميل...</div>}
            {!loading && !requests.length && <EmptyState icon={ClipboardList} title="لا توجد طلبات مطابقة" description="غيّر عوامل البحث أو انتظر وصول طلب شراء جديد من الموقع." className="border-0 py-12" />}
            {requests.map((request) => (
              <button key={request.id} type="button" onClick={() => loadDetail(request.id)} className={`block w-full px-4 py-3 text-start transition-colors hover:bg-slate-50 ${selected?.id === request.id ? "bg-blue-50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-slate-900">{request.request_number}</div>
                    <div className="mt-1 truncate text-sm text-slate-700">{request.requester_name} — {request.project_name}</div>
                  </div>
                  <Badge className={`${statusStyle(request.status)} hover:opacity-90`}>{statusLabel(request.status)}</Badge>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-500">
                  <span>{request.item_count} صنف</span>
                  <span className="text-center">{priorityLabel(request.priority)}</span>
                  <span className="text-end">{request.required_delivery_date || new Date(request.created_at).toLocaleDateString("ar-EG")}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          {!selected ? (
            <div className="flex min-h-[520px] flex-col items-center justify-center text-center text-slate-400">
              <ClipboardList className="h-12 w-12" />
              <p className="mt-3 text-sm">اختر طلباً لعرض التفاصيل والإجراءات.</p>
            </div>
          ) : (
            <div className="space-y-5" data-testid="incoming-request-detail">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
                <div>
                  <div className="text-lg font-bold text-slate-900">{selected.request_number}</div>
                  <div className="text-xs text-slate-500">تم الاستلام {new Date(selected.created_at).toLocaleString("ar-EG")}</div>
                </div>
                <Badge className={statusStyle(selected.status)}>{statusLabel(selected.status)}</Badge>
              </div>

              <ProcurementProgress currentStage={workflowStage(selected.status)} />

              <div className="grid gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 sm:grid-cols-2">
                <div><div className="text-[11px] text-muted-foreground">المرحلة الحالية</div><div className="mt-1 text-sm font-semibold text-foreground">{statusLabel(selected.status)}</div></div>
                <div><div className="text-[11px] text-muted-foreground">الإجراء التالي المطلوب</div><div className="mt-1 text-sm font-semibold text-primary">{nextActionLabel(selected.status)}</div></div>
              </div>

              {selected.status === "need_clarification" && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4" data-testid="clarification-summary">
                  <div className="font-semibold text-amber-950">الطلب يحتاج توضيحًا</div>
                  <div className="mt-2 grid gap-2 text-sm text-amber-900 sm:grid-cols-3">
                    <div><span className="text-xs text-amber-700">السبب</span><div>{latestClarification?.note || "لم يُسجّل سبب تفصيلي"}</div></div>
                    <div><span className="text-xs text-amber-700">طلبه</span><div>{latestClarification?.changed_by || "غير محدد"}</div></div>
                    <div><span className="text-xs text-amber-700">التاريخ / الاستجابة</span><div>{latestClarification?.created_at ? new Date(latestClarification.created_at).toLocaleString("ar-EG") : "-"} · بانتظار الرد</div></div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                <Info label="مقدم الطلب" value={selected.requester_name} />
                <Info label="الشركة" value={selected.company_name} />
                <Info label="الهاتف" value={selected.phone_number} />
                <Info label="المشروع" value={selected.project_name} />
                <Info label="موقع المشروع" value={selected.project_location} />
                <Info label="مكان التسليم" value={selected.delivery_location} />
                <Info label="التسليم المطلوب" value={selected.required_delivery_date} />
                <Info label="الأولوية" value={priorityLabel(selected.priority)} />
                <Info label="الموظف المسؤول" value={selected.assigned_employee} />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm"><a href={`tel:${selected.phone_number}`}><Phone className="ms-1 h-4 w-4" /> اتصال</a></Button>
                {selected.whatsapp_number && <Button asChild variant="outline" size="sm"><a href={`https://wa.me/${selected.whatsapp_number.replace(/\D/g, "")}`} target="_blank" rel="noreferrer"><MessageCircle className="ms-1 h-4 w-4" /> واتساب</a></Button>}
                {selected.email && <Button asChild variant="outline" size="sm"><a href={`mailto:${selected.email}`}><Mail className="ms-1 h-4 w-4" /> بريد إلكتروني</a></Button>}
              </div>

              {selected.project_id ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="rounded-lg bg-emerald-600 p-2 text-white"><FolderKanban className="h-5 w-5" /></div><div><div className="text-xs font-bold text-emerald-700">المشروع مربوط</div><div className="font-bold text-emerald-950">{selected.project_name}</div></div></div><Button type="button" onClick={() => navigate(`/projects/${selected.project_id}/purchases`)}>فتح مركز المشروع</Button></div></div> : <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-lg font-black text-amber-950">المشروع غير مربوط</div><p className="mt-1 text-sm text-amber-800">اربط الطلب قبل متابعة المقارنة حتى تنتقل البيانات تلقائيًا.</p></div><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => openProjectFlow("link")}><FolderKanban className="h-4 w-4" /> ربط بمشروع موجود</Button><Button type="button" onClick={() => openProjectFlow("create")}><PlusCircle className="h-4 w-4" /> إضافة مشروع جديد</Button></div></div></div>}

              {!!projectMode && <div className="rounded-xl border-2 border-blue-300 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><h3 className="font-bold">{projectMode === "link" ? "ربط بمشروع موجود" : projectMode === "similar" ? "وجدنا مشروعًا مشابهًا" : "إنشاء وربط المشروع"}</h3><Button variant="ghost" size="sm" onClick={() => setProjectMode("")}>إغلاق</Button></div>{projectSuggestions.length > 0 && <div className="mt-3 rounded-lg bg-blue-50 p-3"><div className="mb-2 text-sm font-bold">مشروعات مقترحة — لن يتم الربط تلقائيًا</div><div className="space-y-2">{projectSuggestions.map((project) => <div key={project.id} className="flex items-center justify-between rounded-lg bg-white p-3"><div><b>{project.name}</b><div className="text-xs text-slate-500">{project.customer_name || "-"} · {[project.governorate, project.city].filter(Boolean).join(" - ") || "بدون موقع"}</div></div><Button size="sm" variant="outline" onClick={() => linkProject(project.id)}>ربط بالموجود</Button></div>)}</div></div>}{projectMode === "link" && <div className="mt-3 flex gap-2"><select className="h-10 flex-1 rounded-md border px-3" value={projectChoice} onChange={(event) => setProjectChoice(event.target.value)}><option value="">اختر المشروع</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code} — {project.name}</option>)}</select><Button onClick={() => linkProject()}>ربط بالموجود</Button></div>}{["create", "similar"].includes(projectMode) && <div className="mt-3 grid gap-2 md:grid-cols-2"><Input value={projectDraft.name} onChange={(e) => setProjectDraft((x) => ({ ...x, name: e.target.value }))} placeholder="اسم المشروع *" /><Input value={projectDraft.customer_name} onChange={(e) => setProjectDraft((x) => ({ ...x, customer_name: e.target.value }))} placeholder="العميل" /><Input value={projectDraft.governorate} onChange={(e) => setProjectDraft((x) => ({ ...x, governorate: e.target.value }))} placeholder="المحافظة" /><Input value={projectDraft.city} onChange={(e) => setProjectDraft((x) => ({ ...x, city: e.target.value }))} placeholder="المدينة / الموقع" /><Input value={projectDraft.address} onChange={(e) => setProjectDraft((x) => ({ ...x, address: e.target.value }))} placeholder="العنوان" /><Input value={projectDraft.engineer} onChange={(e) => setProjectDraft((x) => ({ ...x, engineer: e.target.value }))} placeholder="المهندس / المسؤول" /><Textarea className="md:col-span-2" value={projectDraft.notes} onChange={(e) => setProjectDraft((x) => ({ ...x, notes: e.target.value }))} placeholder="ملاحظات" /><div className="md:col-span-2 flex justify-end"><Button onClick={() => createAndLinkProject(projectMode === "similar")}>إنشاء وربط المشروع</Button></div></div>}</div>}

              <div>
                <h3 className="mb-2 text-sm font-bold text-slate-800">الأصناف المطلوبة</h3>
                <div className="space-y-2">
                  {selected.items.map((item) => (
                    <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-800 flex items-center gap-1.5">
                            {item.position}. {item.product_name}
                            {!item.item_id && (
                              <>
                                <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50">
                                  صنف يدوي
                                </Badge>
                                {canConvertManualItem && (
                                  <Button
                                    variant="outline" size="sm" className="h-6 px-2 text-[11px]"
                                    data-testid="convert-manual-item-button"
                                    onClick={() => openConvert(item)}
                                  >
                                    إضافة إلى الأصناف
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{[item.main_category, item.subcategory, item.preferred_brand].filter(Boolean).join(" / ") || "بدون تصنيف أو علامة مفضلة"}</div>
                        </div>
                        <div className="whitespace-nowrap rounded-md bg-blue-50 px-2 py-1 text-sm font-bold text-primary">{item.quantity} {item.unit}</div>
                      </div>
                      {item.specifications && <p className="mt-2 text-sm leading-6 text-slate-600">{item.specifications}</p>}
                                            <div className="mt-3 grid gap-2 rounded-md bg-slate-50 p-3 md:grid-cols-[180px_1fr_auto]">
                        <select
                          className="h-9 rounded-md border border-input bg-white px-3 text-sm"
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
                          <option value="pending">قيد المراجعة</option>
                          <option value="approved">معتمد</option>
                          <option value="rejected">مرفوض</option>
                          <option value="need_clarification">يحتاج استكمال</option>
                          <option value="hold">معلّق</option>
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
                          placeholder="سبب الرفض أو طلب الاستكمال"
                        />

                        <Button
                          type="button"
                          size="sm"
                          onClick={() => saveItemReview(item)}
                        >
                          حفظ حالة الصنف
                        </Button>
                      </div>
                      {item.attachment && <Button variant="ghost" size="sm" className="mt-2 h-7 gap-1 px-2 text-primary" onClick={() => openAttachment(item)}><Download className="h-3.5 w-3.5" /> {item.attachment.original_filename}</Button>}
                    </div>
                  ))}
                </div>
              </div>

              {!!documents.length && <div>
                <h3 className="mb-2 text-sm font-bold text-slate-800">المستندات المرفوعة للمراجعة</h3>
                <div className="space-y-2">{documents.map((document) => <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"><div><div className="text-sm font-bold">{document.document_type}</div><div className="mt-1 text-xs text-slate-500">{document.status} · {document.page_count || 0} صفحة</div></div><Button asChild size="sm" variant="outline"><Link to={`/incoming-requests/${selected.id}/documents/${document.id}/review`}><ScanText className="ms-1 h-4 w-4" /> مراجعة الاستخراج</Link></Button></div>)}</div>
              </div>}

              {selected.notes && <div><h3 className="mb-1 text-sm font-bold text-slate-800">ملاحظات مقدم الطلب</h3><p className="rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-600">{selected.notes}</p></div>}

              <div className="grid grid-cols-1 gap-3 border-t border-slate-200 pt-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs">الموظف المسؤول</Label>
                  <div className="flex gap-2"><Input value={assignment} onChange={(event) => setAssignment(event.target.value)} placeholder="اسم الموظف" /><Button variant="outline" onClick={saveAssignment}>حفظ</Button></div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">اسم منفذ الإجراء</Label>
                  <Input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="اسم الموظف" />
                </div>
                {selected.status === "pricing" ? <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4 lg:col-span-2" data-testid="technical-review-complete"><div className="flex items-center gap-3"><CheckCircle2 className="h-8 w-8 text-emerald-700" /><div><h3 className="font-black text-emerald-950">تمت المراجعة الفنية</h3><p className="text-sm text-emerald-800">جاهز للتسعير والمقارنة</p></div></div></div> : ["rejected", "completed", "cancelled"].includes(selected.status) ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800 lg:col-span-2">انتهت المراجعة بحالة: {statusLabel(selected.status)}</div> : canReviewTechnical ? <div className="space-y-3 rounded-xl border-2 border-blue-200 bg-blue-50 p-4 lg:col-span-2" data-testid="technical-review-actions">
                  <div><div className="text-xs font-bold text-blue-700">الإجراء المسؤول: مهندس المشتريات</div><h3 className="font-black text-blue-950">قرار المراجعة الفنية لطلب الشراء</h3></div>
                  <Input value={statusNote} onChange={(event) => setStatusNote(event.target.value)} placeholder="ملاحظة القرار (مطلوبة عند الحاجة للتوضيح)" />
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => technicalDecision("approved_for_pricing")} className="bg-emerald-700 hover:bg-emerald-800">✅ اعتماد للتسعير</Button>
                    <Button variant="outline" onClick={() => technicalDecision("revision_required")}>✏️ تعديل مطلوب</Button>
                    <Button variant="outline" onClick={() => technicalDecision("hold")}>⏸ تعليق</Button>
                    <Button variant="destructive" onClick={() => technicalDecision("rejected")}>❌ رفض</Button>
                  </div>
                </div> : null}
                <div className="space-y-2 lg:col-span-2">
                  <Label className="text-xs">إضافة ملاحظة داخلية</Label>
                  <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="هذه الملاحظة داخلية ولا تظهر لمقدم الطلب" rows={2} />
                  <Button variant="outline" size="sm" onClick={addNote}>إضافة الملاحظة</Button>
                </div>
              </div>

              {(rfq || (canManageRFQ && selected.status === "pricing" && selected.project_id)) && (
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-4" data-testid="rfq-panel">
                  {rfq ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold text-violet-700">طلب تسعير (RFQ)</div>
                        <div className="font-bold text-violet-950">{rfq.rfq_number}</div>
                        <div className="mt-1 text-xs text-violet-800">
                          {rfq.supplier_count} مورد · {rfq.received_quotation_count} عرض مستلم
                          {rfq.deadline && <> · الموعد النهائي: {rfq.deadline}</>}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => navigate(`/rfq/${rfq.id}`)} data-testid="open-rfq-button">
                        فتح RFQ
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm text-violet-900">لم يُنشأ طلب تسعير لهذا الطلب بعد.</div>
                      <Button size="sm" onClick={createOrOpenRfq} disabled={creatingRfq} data-testid="create-rfq-button">
                        إنشاء RFQ
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div className="border-t border-slate-200 pt-4">
                <h3 className="mb-2 text-sm font-bold text-slate-800">التحويلات الآمنة</h3>
                <div className="flex flex-wrap gap-2">

                  <Button
                    variant="default"
                    size="sm"
                    onClick={sendToComparison}
                    disabled={selected.status !== "pricing" || !selected.project_id}
                  >
                    بدء مقارنة الأسعار
                  </Button>
                  <Button variant="outline" size="sm" onClick={convertCustomer} disabled={Boolean(selected.converted_customer_id)}><UserPlus className="ms-1 h-4 w-4" /> {selected.converted_customer_id ? "تم ربط العميل" : "تحويل إلى عميل"}</Button>
                  <Button variant="outline" size="sm" onClick={() => convertDocument("internal_request")} disabled={Boolean(selected.converted_document)}><FileText className="ms-1 h-4 w-4" /> طلب شراء داخلي</Button>
                  <Button variant="outline" size="sm" onClick={() => convertDocument("purchase_draft")} disabled={Boolean(selected.converted_document)}><ClipboardList className="ms-1 h-4 w-4" /> مسودة شراء</Button>
                </div>
                {(selected.status !== "pricing" || !selected.project_id) && <p className="mt-2 text-xs text-amber-700">يتاح بدء المقارنة بعد الاعتماد الفني وربط الطلب بالمشروع.</p>}
                {selected.converted_document && <div className="mt-2 flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" /> تم إنشاء {selected.converted_document.document_number} كمسودة داخلية، وليس عملية شراء مكتملة.</div>}
              </div>

              <div className="border-t border-slate-200 pt-4">
                <h3 className="mb-2 text-sm font-bold text-slate-800">سجل الحالة</h3>
                <div className="space-y-2">
                  {[...selected.status_history].reverse().map((entry) => <div key={entry.id} className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600"><b>{statusLabel(entry.to_status)}</b> — {new Date(entry.created_at).toLocaleString("ar-EG")} {entry.changed_by && `— ${entry.changed_by}`} {entry.note && <div className="mt-1">{entry.note}</div>}</div>)}
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-bold text-slate-800">الملاحظات الداخلية</h3>
                <div className="space-y-2">{selected.internal_notes.length ? selected.internal_notes.map((entry) => <div key={entry.id} className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-slate-700">{entry.note}<div className="mt-1 text-[11px] text-slate-500">{entry.author || "بدون اسم"} — {new Date(entry.created_at).toLocaleString("ar-EG")}</div></div>) : <div className="text-xs text-slate-400">لا توجد ملاحظات داخلية.</div>}</div>
              </div>
            </div>
          )}
        </section>
      </div>

      <Dialog open={!!convertTarget} onOpenChange={(open) => !open && setConvertTarget(null)}>
        <DialogContent dir="rtl" className="max-w-lg" data-testid="convert-manual-item-dialog">
          <DialogHeader>
            <DialogTitle className="text-start">تحويل إلى صنف معتمد</DialogTitle>
            <DialogDescription className="text-start">
              راجع بيانات الصنف اليدوي قبل إضافته إلى دليل الأصناف. النص الأصلي للطلب يبقى محفوظًا كما هو.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">اسم الصنف</Label>
              <Input
                data-testid="convert-form-name"
                value={convertForm.name}
                onChange={(e) => setConvertForm({ ...convertForm, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">الوحدة</Label>
                <Input
                  data-testid="convert-form-unit"
                  value={convertForm.unit}
                  onChange={(e) => setConvertForm({ ...convertForm, unit: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">العلامة التجارية</Label>
                <Input
                  value={convertForm.brand}
                  onChange={(e) => setConvertForm({ ...convertForm, brand: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">التصنيف الرئيسي</Label>
                <Input
                  value={convertForm.main_category}
                  onChange={(e) => setConvertForm({ ...convertForm, main_category: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">التصنيف الفرعي</Label>
                <Input
                  value={convertForm.subcategory}
                  onChange={(e) => setConvertForm({ ...convertForm, subcategory: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">المواصفات / الوصف</Label>
              <Textarea
                rows={3}
                value={convertForm.specifications}
                onChange={(e) => setConvertForm({ ...convertForm, specifications: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConvertTarget(null)}>إلغاء</Button>
            <Button data-testid="convert-form-submit" onClick={submitConvert} disabled={converting}>
              {converting ? "جارٍ التحويل..." : "تحويل إلى صنف معتمد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
