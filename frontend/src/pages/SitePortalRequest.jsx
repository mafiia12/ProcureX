import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Building2, LogOut, Paperclip, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { usePreferences } from "@/contexts/PreferencesContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const PRIORITY_OPTIONS = [
  { value: "low", label: "منخفضة", labelEn: "Low" },
  { value: "normal", label: "عادية", labelEn: "Normal" },
  { value: "high", label: "عالية", labelEn: "High" },
  { value: "urgent", label: "عاجلة", labelEn: "Urgent" },
];

const ACCEPTED_ATTACHMENT_TYPES = [
  "image/png", "image/jpeg", "image/webp", "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
].join(",");

const formatFileSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const localDateInputValue = (date = new Date()) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

export default function SitePortalRequest() {
  const { user, logout } = useAuth();
  const preferences = usePreferences();
  const language = preferences.language || "ar";
  const tr = preferences.tr || ((ar, en) => (language === "en" ? en : ar));
  const direction = preferences.direction || (language === "en" ? "ltr" : "rtl");
  const locale = preferences.locale || (language === "en" ? "en-EG" : "ar-EG");
  const navigate = useNavigate();

  const [context, setContext] = useState(null);
  const [projectId, setProjectId] = useState("");
  const [previousItems, setPreviousItems] = useState([]);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [rows, setRows] = useState([]);
  const [manualFormOpen, setManualFormOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualUnit, setManualUnit] = useState("");
  const [destination, setDestination] = useState("site");
  const today = localDateInputValue();
  const [requiredDate, setRequiredDate] = useState(today);
  const [priority, setPriority] = useState("normal");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [portalRequests, setPortalRequests] = useState([]);
  const [clarificationDrafts, setClarificationDrafts] = useState({});
  const [clarificationFiles, setClarificationFiles] = useState({});
  const [resubmittingId, setResubmittingId] = useState("");
  const [returnedItems, setReturnedItems] = useState([]);
  const [correctionTarget, setCorrectionTarget] = useState(null);
  const [correctionDraft, setCorrectionDraft] = useState({
    product_name: "", unit: "", quantity: 1, note: "", required_delivery_date: today,
  });
  const [correctionFiles, setCorrectionFiles] = useState([]);
  const [correcting, setCorrecting] = useState(false);

  const loadPortalRequests = () => api.get("/portal/purchase-requests")
    .then(({ data }) => setPortalRequests(data || []))
    .catch(() => setPortalRequests([]));
  const loadReturnedItems = () => api.get("/portal/returned-items")
    .then(({ data }) => setReturnedItems(data || []))
    .catch(() => setReturnedItems([]));

  useEffect(() => {
    api.get("/portal/context").then(({ data }) => {
      setContext(data);
      if (data.default_project_id) setProjectId(data.default_project_id);
    }).catch((e) => toast.error(errMsg(e)));
    api.get("/portal/previous-items")
      .then(({ data }) => setPreviousItems(data))
      .catch(() => setPreviousItems([]));
    loadPortalRequests();
    loadReturnedItems();
  }, []);

  useEffect(() => {
    const term = search.trim();
    if (!term) {
      setSearchResults([]);
      return undefined;
    }
    const handle = setTimeout(() => {
      api.get("/portal/items", { params: { search: term } })
        .then(({ data }) => setSearchResults(data))
        .catch(() => setSearchResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [search]);

  const addMasterItem = (item) => {
    setRows((current) => {
      if (current.some((row) => row.item_id === item.id)) {
        toast.info(tr("الصنف مضاف بالفعل إلى الطلب", "This item is already in the request"));
        return current;
      }
      return [...current, {
        key: item.id, item_id: item.id, product_name: item.name, unit: item.unit,
        quantity: 1, note: "",
      }];
    });
  };

  const addManualItem = () => {
    if (!manualName.trim()) {
      toast.error(tr("اسم الصنف مطلوب", "Item name is required"));
      return;
    }
    if (!manualUnit.trim()) {
      toast.error(tr("وحدة الصنف مطلوبة", "Item unit is required"));
      return;
    }
    setRows((current) => [...current, {
      key: `manual-${Date.now()}-${current.length}`, item_id: "",
      product_name: manualName.trim(), unit: manualUnit.trim(),
      quantity: 1, note: "",
    }]);
    setManualName("");
    setManualUnit("");
    setManualFormOpen(false);
  };

  const removeRow = (key) => setRows((current) => current.filter((row) => row.key !== key));
  const updateRow = (key, patch) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const addFiles = (fileList) => {
    setFiles((current) => [...current, ...Array.from(fileList)]);
  };
  const removeFile = (index) => setFiles((current) => current.filter((_, i) => i !== index));

  const submitClarification = async (request) => {
    const response = (clarificationDrafts[request.id] || "").trim();
    if (!response) {
      toast.error(tr("اكتب رد التوضيح أولًا", "Enter a clarification response first"));
      return;
    }
    const form = new FormData();
    form.append("response", response);
    (clarificationFiles[request.id] || []).forEach((file) => form.append("attachments", file));
    setResubmittingId(request.id);
    try {
      await api.post(`/portal/purchase-requests/${request.id}/clarification`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(tr(`تمت إعادة إرسال ${request.request_number} للمراجعة`, `${request.request_number} was resubmitted for review`));
      setClarificationDrafts((current) => ({ ...current, [request.id]: "" }));
      setClarificationFiles((current) => ({ ...current, [request.id]: [] }));
      await loadPortalRequests();
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setResubmittingId("");
    }
  };

  const openCorrection = (item) => {
    setCorrectionTarget(item);
    setCorrectionDraft({
      product_name: item.product_name || "", unit: item.unit || "",
      quantity: Number(item.quantity || 1), note: item.specifications || "",
      required_delivery_date: today,
    });
    setCorrectionFiles([]);
  };

  const submitCorrection = async () => {
    if (!correctionTarget) return;
    if (!(Number(correctionDraft.quantity) > 0)) {
      toast.error(tr("الكمية يجب أن تكون أكبر من صفر", "Quantity must be greater than zero"));
      return;
    }
    const form = new FormData();
    form.append("payload", JSON.stringify({
      ...correctionDraft, quantity: Number(correctionDraft.quantity),
    }));
    correctionFiles.forEach((file) => form.append("attachments", file));
    setCorrecting(true);
    try {
      const { data } = await api.post(
        `/portal/returned-items/${correctionTarget.id}/correct`, form,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      toast.success(data.already_exists
        ? tr(`تم تقديم هذا الصنف بالفعل في ${data.request_number}`, `This item was already resubmitted in ${data.request_number}`)
        : tr(`تم إنشاء الطلب المصحح ${data.request_number}`, `Corrected request ${data.request_number} was created`));
      setCorrectionTarget(null);
      await Promise.all([loadReturnedItems(), loadPortalRequests()]);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setCorrecting(false);
    }
  };

  const projects = context?.projects ?? [];
  const noProjectAssigned = context !== null && projects.length === 0;
  const needsProjectChoice = projects.length > 1 && !projectId;

  const submit = async () => {
    if (noProjectAssigned) {
      toast.error(tr("لا يوجد مشروع مخصص لهذا الحساب. برجاء التواصل مع المسؤول", "No project is assigned to this account. Contact the administrator."));
      return;
    }
    if (needsProjectChoice) {
      toast.error(tr("يرجى اختيار المشروع أولاً", "Select a project first"));
      return;
    }
    if (!requiredDate) {
      toast.error(tr("يرجى تحديد تاريخ التسليم المطلوب", "Select the required delivery date"));
      return;
    }
    if (rows.length === 0) {
      toast.error(tr("يرجى إضافة صنف واحد على الأقل", "Add at least one item"));
      return;
    }

    const items = rows.map((row) => (row.item_id
      ? { item_id: row.item_id, quantity: Number(row.quantity) || 0, note: row.note }
      : {
        product_name: row.product_name, unit: row.unit,
        quantity: Number(row.quantity) || 0, note: row.note,
      }));

    const payload = {
      required_delivery_date: requiredDate,
      priority,
      delivery_destination: destination,
      notes,
      project_id: projectId,
      items,
    };

    const form = new FormData();
    form.append("payload", JSON.stringify(payload));
    files.forEach((file) => form.append("attachments", file));

    setSubmitting(true);
    try {
      const { data } = await api.post("/portal/purchase-requests", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(tr(`تم إرسال الطلب بنجاح — رقم الطلب ${data.request_number}`, `Request submitted successfully — ${data.request_number}`));
      setRows([]);
      setFiles([]);
      setNotes("");
      setRequiredDate(today);
      loadPortalRequests();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground" dir={direction} data-testid="site-portal-request-page">
      <header className="flex items-center justify-between border-b bg-card px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-md bg-primary flex items-center justify-center">
            <Building2 className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-foreground" style={{ fontFamily: "Cairo" }}>
              {tr("بوابة طلبات الشراء", "Purchase Request Portal")}
            </div>
            <div className="text-xs text-muted-foreground">
              {context?.requester_name || user?.display_name}
            </div>
          </div>
        </div>
        <Button
          variant="outline" size="sm" className="gap-2" data-testid="portal-logout-button"
          onClick={() => { logout(); navigate("/login"); }}
        >
          <LogOut className="h-3.5 w-3.5" /> {tr("تسجيل الخروج", "Sign out")}
        </Button>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        {!!returnedItems.length && <section className="rounded-lg border border-amber-500/30 bg-card p-4" data-testid="returned-items-section">
          <div className="mb-3"><h1 className="text-base font-bold">{tr("أصناف تحتاج إجراء", "Items Needing Action")}</h1><p className="mt-1 text-xs text-muted-foreground">{tr("هذه البنود خرجت من مسار التسعير الحالي. صحح البند لإنشاء طلب جديد مرتبط بالأصل.", "These items are excluded from the current sourcing path. Correct an item to create a new request linked to the original.")}</p></div>
          <div className="space-y-2">{returnedItems.map((item) => <article key={item.id} className="rounded-md border bg-muted/30 p-3" data-testid="returned-item">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><div className="flex items-center gap-2"><span className="font-mono text-xs font-bold" dir="ltr">{item.request_number}</span><span className="rounded-full bg-background px-2 py-0.5 text-[11px] ring-1 ring-border">{item.status === "rejected" ? tr("مرفوض", "Rejected") : tr("يحتاج استكمال", "Needs Completion")}</span></div><div className="mt-1 font-semibold">{item.product_name}</div><div className="text-xs text-muted-foreground">{item.quantity} {item.unit} · {item.project_name}</div></div>
              {item.corrected_request ? <div className="text-end text-xs text-emerald-700 dark:text-emerald-300"><div>{tr("أُعيد تقديمه", "Resubmitted")}</div><div className="font-mono font-bold" dir="ltr">{item.corrected_request.request_number}</div></div> : <Button size="sm" variant="outline" onClick={() => openCorrection(item)} data-testid={`correct-returned-item-${item.id}`}><RotateCcw className="h-3.5 w-3.5" />{tr("تصحيح وإعادة الطلب", "Correct and Re-submit Item")}</Button>}
            </div>
            <dl className="mt-3 grid gap-2 rounded-md bg-background/70 p-3 text-xs sm:grid-cols-3"><div><dt className="text-muted-foreground">{tr("السبب", "Reason")}</dt><dd className="mt-1 font-semibold">{item.reason || "-"}</dd></div><div><dt className="text-muted-foreground">{tr("المراجع", "Reviewer")}</dt><dd className="mt-1 font-semibold">{item.reviewer || "-"}</dd></div><div><dt className="text-muted-foreground">{tr("التاريخ", "Date")}</dt><dd className="mt-1 font-semibold">{item.reviewed_at ? new Date(item.reviewed_at).toLocaleString(locale) : "-"}</dd></div></dl>
          </article>)}</div>
        </section>}
        {!!portalRequests.length && <section className="rounded-lg border bg-card p-4" data-testid="portal-request-history">
          <div className="mb-3"><h1 className="text-base font-bold">{tr("طلباتي الأخيرة", "My Recent Requests")}</h1><p className="mt-1 text-xs text-muted-foreground">{tr("طلبات التوضيح تظهر هنا للرد وإعادة إرسال نفس رقم الطلب.", "Clarification requests appear here so you can respond and resubmit the same REQ.")}</p></div>
          <div className="space-y-2">{portalRequests.slice(0, 8).map((request) => <article key={request.id} className={`rounded-md border p-3 ${request.status === "need_clarification" ? "border-amber-500/40 bg-amber-500/10" : "bg-muted/30"}`} data-testid="portal-request-history-item">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-mono text-sm font-bold" dir="ltr">{request.request_number}</div><div className="text-xs text-muted-foreground">{request.project_name} · {new Date(request.updated_at || request.created_at).toLocaleDateString(locale)}</div></div><span className="rounded-full bg-background px-2 py-1 text-xs font-semibold ring-1 ring-border">{request.status === "need_clarification" ? tr("يحتاج توضيح", "Needs Clarification") : request.status === "under_review" ? tr("قيد المراجعة", "Under Review") : request.status === "new" ? tr("جديد", "New") : request.status}</span></div>
            {request.status === "need_clarification" && request.clarification && <div className="mt-3 space-y-3" data-testid="portal-clarification-card">
              <dl className="grid gap-2 rounded-md bg-background/70 p-3 text-xs sm:grid-cols-3"><div><dt className="text-muted-foreground">{tr("سبب التوضيح", "Clarification Reason")}</dt><dd className="mt-1 font-semibold">{request.clarification.reason}</dd></div><div><dt className="text-muted-foreground">{tr("طلبه", "Requested By")}</dt><dd className="mt-1 font-semibold">{request.clarification.requested_by || "-"}</dd></div><div><dt className="text-muted-foreground">{tr("التاريخ", "Date")}</dt><dd className="mt-1 font-semibold">{new Date(request.clarification.requested_at).toLocaleString(locale)}</dd></div></dl>
              <div><Label htmlFor={`clarification-${request.id}`}>{tr("رد التوضيح *", "Clarification Response *")}</Label><Textarea id={`clarification-${request.id}`} className="mt-1.5 bg-background" rows={3} value={clarificationDrafts[request.id] || ""} onChange={(event) => setClarificationDrafts((current) => ({ ...current, [request.id]: event.target.value }))} data-testid="portal-clarification-response" /></div>
              <div className="flex flex-wrap items-center justify-between gap-2"><label className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs hover:bg-muted"><Paperclip className="h-4 w-4" />{tr("إضافة مرفقات", "Add Attachments")}<input type="file" multiple className="hidden" accept={ACCEPTED_ATTACHMENT_TYPES} onChange={(event) => setClarificationFiles((current) => ({ ...current, [request.id]: Array.from(event.target.files || []) }))} data-testid="portal-clarification-attachments" /></label><Button type="button" onClick={() => submitClarification(request)} disabled={resubmittingId === request.id} data-testid="portal-clarification-resubmit">{resubmittingId === request.id ? tr("جارٍ إعادة الإرسال...", "Resubmitting...") : tr("إعادة الإرسال للمراجعة", "Resubmit for Review")}</Button></div>
              {!!clarificationFiles[request.id]?.length && <div className="text-xs text-muted-foreground">{clarificationFiles[request.id].map((file) => file.name).join(" · ")}</div>}
            </div>}
            {request.status !== "need_clarification" && request.clarification?.response_status === "submitted" && <div className="mt-2 rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">{tr("تم إرسال التوضيح وعاد نفس الطلب إلى المراجعة.", "Clarification submitted; the same REQ is back under review.")}</div>}
          </article>)}</div>
        </section>}
        {noProjectAssigned && (
          <div
            className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm"
            data-testid="no-project-message"
          >
            {tr("لا يوجد مشروع مخصص لهذا الحساب. برجاء التواصل مع المسؤول.", "No project is assigned to this account. Contact the administrator.")}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 rounded-lg border bg-card p-4 md:grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground">{tr("مقدم الطلب", "Requester")}</Label>
            <div className="text-sm font-medium" data-testid="portal-requester-name">
              {context?.requester_name}
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{tr("المشروع", "Project")}</Label>
            {projects.length > 1 ? (
              <Select data-testid="portal-project-select" value={projectId} onValueChange={setProjectId}>
                <SelectTrigger data-testid="portal-project-select-trigger">
                  <SelectValue placeholder={tr("اختر المشروع", "Select project")} />
                </SelectTrigger>
                <SelectContent dir={direction}>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="text-sm font-medium" data-testid="portal-project-readonly">
                {projects[0]?.name || "—"}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 rounded-lg border bg-card p-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>{tr("تاريخ التسليم المطلوب", "Required Delivery Date")}</Label>
            <Input
              type="date" data-testid="portal-required-date"
              min={today}
              value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{tr("الأولوية", "Priority")}</Label>
            <Select data-testid="portal-priority-select" value={priority} onValueChange={setPriority}>
              <SelectTrigger data-testid="portal-priority-select-trigger"><SelectValue /></SelectTrigger>
              <SelectContent dir={direction}>
                {PRIORITY_OPTIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{tr(p.label, p.labelEn)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{tr("وجهة التسليم", "Delivery Destination")}</Label>
            <Select data-testid="portal-destination-select" value={destination} onValueChange={setDestination}>
              <SelectTrigger data-testid="portal-destination-select-trigger"><SelectValue /></SelectTrigger>
              <SelectContent dir={direction}>
                <SelectItem value="site">{tr("الموقع", "Site")}</SelectItem>
                <SelectItem value="warehouse">{tr("المخزن", "Warehouse")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {correctionTarget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCorrectionTarget(null); }}>
          <section className="w-full max-w-lg space-y-4 rounded-lg border bg-card p-5 shadow-xl" role="dialog" aria-modal="true" aria-label={tr("تصحيح وإعادة طلب الصنف", "Correct and resubmit item")} data-testid="returned-item-correction-dialog">
            <div><h2 className="font-bold">{tr("تصحيح وإعادة طلب الصنف", "Correct and Re-submit Item")}</h2><p className="mt-1 text-xs text-muted-foreground">{tr(`سيُنشأ طلب جديد مرتبط بـ ${correctionTarget.request_number}. لن يتغير الطلب الأصلي.`, `A new request linked to ${correctionTarget.request_number} will be created. The original request will not change.`)}</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>{tr("الصنف", "Item")}</Label><Input value={correctionDraft.product_name} disabled={Boolean(correctionTarget.item_id)} onChange={(event) => setCorrectionDraft((current) => ({ ...current, product_name: event.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{tr("الوحدة", "Unit")}</Label><Input value={correctionDraft.unit} disabled={Boolean(correctionTarget.item_id)} onChange={(event) => setCorrectionDraft((current) => ({ ...current, unit: event.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{tr("الكمية *", "Quantity *")}</Label><Input type="number" min="0.001" step="any" value={correctionDraft.quantity} onChange={(event) => setCorrectionDraft((current) => ({ ...current, quantity: event.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{tr("تاريخ التسليم المطلوب", "Required Delivery Date")}</Label><Input type="date" min={today} value={correctionDraft.required_delivery_date} onChange={(event) => setCorrectionDraft((current) => ({ ...current, required_delivery_date: event.target.value }))} /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label>{tr("التصحيح / المواصفات", "Correction / Specifications")}</Label><Textarea rows={3} value={correctionDraft.note} onChange={(event) => setCorrectionDraft((current) => ({ ...current, note: event.target.value }))} /></div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2"><label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-muted"><Paperclip className="h-4 w-4" />{tr("إضافة مرفقات", "Add Attachments")}<input type="file" multiple className="hidden" accept={ACCEPTED_ATTACHMENT_TYPES} onChange={(event) => setCorrectionFiles(Array.from(event.target.files || []))} /></label><div className="flex gap-2"><Button variant="outline" onClick={() => setCorrectionTarget(null)}>{tr("إلغاء", "Cancel")}</Button><Button onClick={submitCorrection} disabled={correcting} data-testid="submit-corrected-item">{correcting ? tr("جارٍ الإرسال...", "Submitting...") : tr("إنشاء الطلب المصحح", "Create Corrected Request")}</Button></div></div>
            {!!correctionFiles.length && <div className="text-xs text-muted-foreground">{correctionFiles.map((file) => file.name).join(" · ")}</div>}
          </section>
        </div>}

        {/* -------- الأصناف -------- */}
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <Label className="block text-xs text-muted-foreground">{tr("الأصناف", "Items")}</Label>

          {previousItems.length > 0 && (
            <div className="space-y-2" data-testid="portal-previous-items">
              <div className="text-xs font-bold text-muted-foreground">{tr("منتجات سابقة", "Previously Requested")}</div>
              <div className="flex flex-wrap gap-2">
                {previousItems.map((item) => (
                  <button
                    key={item.id} type="button" data-testid="portal-previous-item-chip"
                    className="rounded-full border px-3 py-1.5 text-xs hover:bg-muted"
                    onClick={() => addMasterItem(item)}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                data-testid="portal-item-search-input"
                className="ps-9"
                placeholder={tr("ابحث بالاسم أو الكود...", "Search by name or code...")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {searchResults.length > 0 && (
              <div className="border rounded-md divide-y max-h-56 overflow-y-auto" data-testid="portal-item-search-results">
                {searchResults.map((item) => (
                  <button
                    key={item.id} type="button" data-testid="portal-item-search-result"
                    className="flex w-full justify-between px-3 py-2 text-start text-sm hover:bg-muted"
                    onClick={() => addMasterItem(item)}
                  >
                    <span>{item.name}</span>
                    <span className="text-slate-400 text-xs">{item.code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {!manualFormOpen ? (
            <button
              type="button" data-testid="portal-add-manual-item-button"
              className="text-sm text-primary font-medium flex items-center gap-1.5 hover:underline"
              onClick={() => setManualFormOpen(true)}
            >
              <Plus className="h-4 w-4" /> {tr("الصنف غير موجود؟ إضافة صنف يدوي", "Item not found? Add a manual item")}
            </button>
          ) : (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3" data-testid="portal-manual-item-form">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">{tr("اسم الصنف", "Item Name")}</Label>
                  <Input
                    data-testid="portal-manual-item-name"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{tr("الوحدة", "Unit")}</Label>
                  <Input
                    data-testid="portal-manual-item-unit"
                    value={manualUnit}
                    onChange={(e) => setManualUnit(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setManualFormOpen(false)}>{tr("إلغاء", "Cancel")}</Button>
                <Button size="sm" data-testid="portal-manual-item-add-button" onClick={addManualItem}>
                  {tr("إضافة صنف", "Add Item")}
                </Button>
              </div>
            </div>
          )}

          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{tr("لم تتم إضافة أصناف بعد", "No items added yet")}</p>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <div
                  key={row.key}
                  className="border rounded-md p-3 grid grid-cols-1 md:grid-cols-12 gap-2 items-end"
                  data-testid="portal-request-row"
                  data-manual={row.item_id ? "false" : "true"}
                >
                  <div className="md:col-span-4">
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      {row.product_name}
                      {!row.item_id && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700"
                          data-testid="portal-row-manual-badge"
                        >
                          {tr("صنف يدوي", "Manual item")}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400">{row.unit}</div>
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <Label className="text-xs">{tr("الكمية", "Quantity")}</Label>
                    <Input
                      type="number" min="0" step="any"
                      data-testid="portal-row-quantity"
                      value={row.quantity}
                      onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                    />
                  </div>
                  <div className="md:col-span-5 space-y-1">
                    <Label className="text-xs">{tr("ملاحظات / مواصفات", "Notes / Specifications")}</Label>
                    <Input
                      data-testid="portal-row-note"
                      value={row.note}
                      onChange={(e) => updateRow(row.key, { note: e.target.value })}
                    />
                  </div>
                  <div className="md:col-span-1">
                    <Button variant="ghost" size="icon" onClick={() => removeRow(row.key)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* -------- مرفقات الطلب -------- */}
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <Label className="block text-xs text-muted-foreground">{tr("مرفقات الطلب", "Request Attachments")}</Label>
          <div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
              <Paperclip className="h-4 w-4" />
              {tr("رفع ملفات", "Upload Files")}
              <input
                type="file" multiple data-testid="portal-attachment-input"
                accept={ACCEPTED_ATTACHMENT_TYPES}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <span className="ms-2 text-xs text-muted-foreground">{tr("صور / PDF / Excel", "Images / PDF / Excel")}</span>
          </div>
          {files.length > 0 && (
            <ul className="space-y-1.5" data-testid="portal-attachment-list">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center justify-between text-sm border rounded-md px-3 py-1.5"
                  data-testid="portal-attachment-item"
                >
                  <span className="truncate">{file.name}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-slate-400">{formatFileSize(file.size)}</span>
                    <button
                      type="button" data-testid="portal-attachment-remove"
                      onClick={() => removeFile(index)}
                      aria-label={tr("إزالة الملف", "Remove file")}
                    >
                      <X className="h-3.5 w-3.5 text-slate-500" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-1.5 rounded-lg border bg-card p-4">
          <Label>{tr("ملاحظات عامة", "General Notes")}</Label>
          <Textarea
            data-testid="portal-general-notes" value={notes}
            onChange={(e) => setNotes(e.target.value)} rows={3}
          />
        </div>

        <Button
          className="w-full" data-testid="portal-submit-button"
          disabled={submitting || noProjectAssigned}
          onClick={submit}
        >
          {submitting ? tr("جارٍ الإرسال...", "Submitting...") : tr("إرسال طلب الشراء", "Submit Purchase Request")}
        </Button>
      </main>
    </div>
  );
}
