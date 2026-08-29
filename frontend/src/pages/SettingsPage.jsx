import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, DatabaseBackup, FolderOpen, Loader2, MessageCircle, Plus, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, SectionHeader, StatusBadge } from "@/components/procurement-ui";
import PreferenceControls from "@/components/PreferenceControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import api, { errMsg } from "@/lib/api";
import { usePreferences } from "@/contexts/PreferencesContext";

const EDITABLE_REFERENCE_LISTS = new Set(["currencies"]);
export default function SettingsPage() {
  const preferences = usePreferences();
  const { t } = preferences;
  const language = preferences.language || "ar";
  const tr = preferences.tr || ((ar, en) => (language === "en" ? en : ar));
  const locale = preferences.locale || (language === "en" ? "en-EG" : "ar-EG");
  const referenceLabels = {
    currencies: tr("العملات المرجعية", "Reference currencies"),
    units: tr("وحدات القياس", "Units of measure"),
    vat_rates: tr("نسب ضريبة القيمة المضافة", "VAT rates"),
  };
  const navigate = useNavigate();
  const [lists, setLists] = useState([]);
  const [inputs, setInputs] = useState({});
  const [diagnostics, setDiagnostics] = useState(null);
  const [backingUp, setBackingUp] = useState(false);
  const [whatsapp, setWhatsapp] = useState(null);
  const [whatsappBusy, setWhatsappBusy] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  const load = () => Promise.all([
    api.get("/settings"), api.get("/system/diagnostics"),
    api.get("/admin/whatsapp/settings").catch(() => null),
  ]).then(([settingsResponse, diagnosticsResponse, whatsappResponse]) => {
    setLists(settingsResponse.data || []);
    setDiagnostics(diagnosticsResponse.data);
    setWhatsapp(whatsappResponse?.data || null);
  }).catch((error) => toast.error(errMsg(error)));

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleLists = useMemo(
    () => lists.filter((list) => EDITABLE_REFERENCE_LISTS.has(list.key)),
    [lists],
  );

  const saveList = async (key, values) => {
    try {
      await api.put(`/settings/${key}`, { values });
      toast.success(t("settings.updated"));
      setLists((current) => current.map((list) => list.key === key ? { ...list, values } : list));
    } catch (error) { toast.error(errMsg(error)); }
  };

  const addValue = (list) => {
    const value = (inputs[list.key] || "").trim();
    if (!value) return toast.error(t("settings.enterValue"));
    const normalized = list.key === "vat_rates" ? Number(value) : value;
    if (list.key === "vat_rates" && !Number.isFinite(normalized)) return toast.error(t("settings.numericVat"));
    if (list.values.map(String).includes(String(normalized))) return toast.error(t("settings.duplicateValue"));
    setInputs((current) => ({ ...current, [list.key]: "" }));
    saveList(list.key, [...list.values, normalized]);
  };

  const createBackup = async () => {
    setBackingUp(true);
    try {
      await api.post("/system/backup");
      toast.success(t("settings.backupCreated"));
      load();
    } catch (error) { toast.error(errMsg(error)); }
    finally { setBackingUp(false); }
  };

  const openFolder = async (kind) => {
    try { await api.post(`/system/open-folder/${kind}`); }
    catch (error) { toast.error(errMsg(error)); }
  };

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      toast.success(t("settings.diagnosticsCopied"));
    } catch { toast.error(errMsg()); }
  };

  const toggleWhatsapp = async (nextEnabled) => {
    setWhatsappBusy(true);
    try {
      const { data } = await api.put("/admin/whatsapp/settings", { enabled: nextEnabled });
      setWhatsapp(data);
      toast.success(nextEnabled ? tr("تم تفعيل طلبات واتساب", "WhatsApp requests enabled") : tr("تم إيقاف طلبات واتساب", "WhatsApp requests disabled"));
    } catch (error) { toast.error(errMsg(error)); }
    finally { setWhatsappBusy(false); }
  };

  const testWhatsappConnection = async () => {
    setTestingConnection(true);
    try {
      const { data } = await api.post("/admin/whatsapp/settings/test-connection");
      setWhatsapp(data);
      if (data.connection_status === "connected") toast.success(tr("تم الاتصال بنجاح ✅", "Connected successfully ✅"));
      else toast.error(data.connection_error || tr("تعذر الاتصال بحساب WhatsApp Business.", "Could not connect to the WhatsApp Business account."));
    } catch (error) { toast.error(errMsg(error)); }
    finally { setTestingConnection(false); }
  };

  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(whatsapp?.webhook_url || "");
      toast.success(tr("تم نسخ الرابط", "Link copied"));
    } catch { toast.error(errMsg()); }
  };

  return (
    <div className="space-y-5" data-testid="settings-page">
      <PageHeader
        title={tr("الإعدادات", "Settings")}
        description={tr("إعدادات تشغيلية آمنة فقط. حالات سير العمل والترقيم وقواعد الاعتماد ثابتة ولا يمكن تعديلها من هنا.", "Safe operational settings only. Workflow statuses, numbering, and approval rules are fixed and cannot be changed here.")}
      />

      <section className="rounded-lg border bg-card p-4">
        <SectionHeader title={tr("عام", "General")} description={tr("تفضيلات العرض واللغة للمستخدم الحالي.", "Display and language preferences for the current user.")} />
        <PreferenceControls />
      </section>

      {!!visibleLists.length && (
        <section className="rounded-lg border bg-card p-4">
          <SectionHeader title={tr("المشتريات", "Procurement")} description={tr("قوائم مرجعية غير مرتبطة بحالات أو صلاحيات سير العمل.", "Reference lists that do not control workflow stages or permissions.")} />
          <div className="grid gap-3 lg:grid-cols-3">
            {visibleLists.map((list) => (
              <div key={list.key} className="rounded-lg border bg-muted/40 p-3" data-testid={`settings-list-${list.key}`}>
                <h3 className="text-sm font-bold text-foreground">{referenceLabels[list.key]}</h3>
                <div className="mt-3 flex min-h-8 flex-wrap gap-1.5">
                  {list.values.map((value, index) => (
                    <span key={`${value}-${index}`} className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-xs text-foreground ring-1 ring-border">
                      {list.key === "vat_rates" ? `${Number(value).toLocaleString(locale)}%` : value}
                      <button type="button" data-testid={`settings-remove-${list.key}-${index}`} onClick={() => saveList(list.key, list.values.filter((_, itemIndex) => itemIndex !== index))} className="text-muted-foreground hover:text-destructive" aria-label={`${tr("حذف", "Remove")} ${value}`}><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                  {!list.values.length && <span className="text-xs text-muted-foreground">{tr("لا توجد قيم مرجعية.", "No reference values.")}</span>}
                </div>
                <div className="mt-3 flex gap-2">
                  <Input className="h-9 text-xs" placeholder={tr("قيمة جديدة", "New value")} value={inputs[list.key] || ""} onChange={(event) => setInputs((current) => ({ ...current, [list.key]: event.target.value }))} onKeyDown={(event) => event.key === "Enter" && addValue(list)} data-testid={`settings-input-${list.key}`} />
                  <Button type="button" size="sm" variant="outline" className="h-9 shrink-0" onClick={() => addValue(list)} data-testid={`settings-add-${list.key}`}><Plus className="h-3.5 w-3.5" /> {tr("إضافة", "Add")}</Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {whatsapp && (() => {
        const metaReady = whatsapp.setup_categories.find((category) => category.key === "meta_credentials")?.ready;
        const webhookReady = whatsapp.setup_categories.find((category) => category.key === "public_webhook")?.ready;
        return (
          <section className="rounded-lg border bg-card p-4" data-testid="whatsapp-settings-section">
            <SectionHeader
              title={tr("طلبات الشراء عبر واتساب", "WhatsApp Purchase Requests")}
              description={tr("قناة استقبال إضافية لنفس نظام طلبات الشراء — بدون صفحة أو سير عمل منفصل.", "An additional intake channel for the same purchase-request workflow — no separate page or workflow.")}
              action={metaReady && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{whatsapp.enabled ? tr("مفعل", "Enabled") : tr("متوقف", "Disabled")}</span>
                  <Switch checked={whatsapp.enabled} disabled={whatsappBusy} onCheckedChange={toggleWhatsapp} data-testid="whatsapp-enabled-switch" />
                </div>
              )}
            />
            {!metaReady ? (
              <ol className="list-decimal space-y-1.5 ps-4 text-xs text-muted-foreground" data-testid="whatsapp-setup-checklist">
                <li>{tr("اربط رقم واتساب بزنس الخاص بالشركة", "Connect the company's WhatsApp Business number")}</li>
                <li>{tr("أضف بيانات اعتماد Meta على السيرفر", "Configure Meta credentials on the server")}</li>
                <li>
                  {tr("سجّل رابط الويب هوك الظاهر أدناه في إعدادات Meta", "Register the webhook URL shown below in Meta's settings")}:{" "}
                  {whatsapp.webhook_url_configured ? (
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]" dir="ltr">{whatsapp.webhook_url}</code>
                  ) : (
                    <span className="italic">{tr("الرابط العام للويب هوك غير مهيأ", "Public webhook URL is not configured")}</span>
                  )}
                </li>
                <li>{tr("اختبر الاتصال", "Test the connection")}</li>
                <li>{tr("فعّل طلبات واتساب", "Enable WhatsApp Requests")}</li>
              </ol>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md bg-muted/60 p-3 text-sm">
                  <span className="block text-[11px] text-muted-foreground">{tr("الرقم التجاري", "Business number")}</span>
                  <strong dir="ltr">{whatsapp.business_number || tr("لم يتم الربط بعد", "Not linked yet")}</strong>
                </div>
                <div className="rounded-md bg-muted/60 p-3 text-sm">
                  <span className="block text-[11px] text-muted-foreground">{tr("الاتصال", "Connection")}</span>
                  <StatusBadge tone={whatsapp.connection_status === "connected" ? "success" : "neutral"}>
                    {whatsapp.connection_status === "connected" ? tr("متصل ✅", "Connected ✅") : tr("غير متصل", "Not connected")}
                  </StatusBadge>
                </div>
                <div className="rounded-md bg-muted/60 p-3 text-sm sm:col-span-2">
                  <span className="block text-[11px] text-muted-foreground">{tr("الويب هوك", "Webhook")}</span>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusBadge tone={webhookReady ? "success" : "neutral"}>
                      {webhookReady ? tr("متصل ✅", "Connected ✅") : tr("بانتظار Meta", "Waiting for Meta")}
                    </StatusBadge>
                    {whatsapp.webhook_url_configured ? (
                      <>
                        <code className="truncate rounded bg-card px-2 py-1 text-[11px]" dir="ltr">{whatsapp.webhook_url}</code>
                        <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={copyWebhookUrl}><Copy className="h-3.5 w-3.5" />{tr("نسخ", "Copy")}</Button>
                      </>
                    ) : (
                      <span className="text-xs italic text-muted-foreground" data-testid="whatsapp-webhook-url-missing">
                        {tr("الرابط العام للويب هوك غير مهيأ", "Public webhook URL is not configured")}
                      </span>
                    )}
                  </div>
                  {!whatsapp.webhook_url_configured && whatsapp.local_backend_url && (
                    <div className="mt-1 text-[10.5px] text-muted-foreground">
                      {tr("الرابط المحلي (لتشخيص فقط، ليس صالحًا لـ Meta): ", "Local URL (diagnostic only, not valid for Meta): ")}
                      <code dir="ltr">{whatsapp.local_backend_url}</code>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between rounded-md bg-muted/60 p-3 text-sm sm:col-span-2">
                  <div>
                    <span className="block text-[11px] text-muted-foreground">{tr("المهندسون المسجلون", "Registered engineers")}</span>
                    <strong>{whatsapp.engineers.with_phone} / {whatsapp.engineers.total}</strong>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => navigate("/admin/users")}>{tr("إدارة أرقام المهندسين", "Manage engineer numbers")}</Button>
                </div>
                <div className="sm:col-span-2">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={testWhatsappConnection} disabled={testingConnection} data-testid="whatsapp-test-connection">
                    {testingConnection ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                    {tr("اختبار الاتصال", "Test Connection")}
                  </Button>
                </div>
              </div>
            )}
          </section>
        );
      })()}

      {diagnostics?.database && (
        <section className="rounded-lg border bg-card p-4" data-testid="system-diagnostics">
          <SectionHeader title={tr("النظام والنسخ الاحتياطي", "System & Backup")} description={tr("معلومات تشخيصية للمدير؛ إعدادات الترقيم وسير العمل للقراءة فقط.", "Administrator diagnostics; numbering and workflow configuration remain read-only.")} />
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div className="rounded-md bg-muted/60 p-3"><span className="block text-[11px] text-muted-foreground">{tr("الإصدار", "Version")}</span><strong>{diagnostics.version}</strong></div>
            <div className="rounded-md bg-muted/60 p-3"><span className="block text-[11px] text-muted-foreground">{tr("وضع التشغيل", "Mode")}</span><strong>{t(`settings.${diagnostics.mode}`)}</strong></div>
            <div className="rounded-md bg-muted/60 p-3"><span className="block text-[11px] text-muted-foreground">{tr("قاعدة البيانات", "Database")}</span><strong className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-4 w-4" />{diagnostics.database.status === "healthy" ? t("settings.healthy") : diagnostics.database.status}</strong></div>
            <div className="rounded-md bg-muted/60 p-3"><span className="block text-[11px] text-muted-foreground">{tr("آخر نسخة احتياطية", "Latest backup")}</span><strong className="text-xs">{diagnostics.last_backup?.created_utc ? new Date(diagnostics.last_backup.created_utc).toLocaleString(locale) : t("settings.noBackup")}</strong></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={createBackup} disabled={backingUp} data-testid="create-system-backup"><DatabaseBackup className="h-4 w-4" />{backingUp ? t("settings.creatingBackup") : t("settings.createBackup")}</Button>
            <Button size="sm" variant="outline" onClick={copyDiagnostics} data-testid="copy-system-diagnostics"><Copy className="h-4 w-4" />{t("settings.copyDiagnostics")}</Button>
            {[["data", "openData"], ["backups", "openBackups"], ["logs", "openLogs"]].map(([kind, label]) => <Button key={kind} size="sm" variant="ghost" onClick={() => openFolder(kind)} data-testid={`open-${kind}-folder`}><FolderOpen className="h-4 w-4" />{t(`settings.${label}`)}</Button>)}
          </div>
        </section>
      )}
    </div>
  );
}
