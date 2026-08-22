import { useEffect, useMemo, useState } from "react";
import { Copy, DatabaseBackup, FolderOpen, Plus, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, SectionHeader } from "@/components/procurement-ui";
import PreferenceControls from "@/components/PreferenceControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [lists, setLists] = useState([]);
  const [inputs, setInputs] = useState({});
  const [diagnostics, setDiagnostics] = useState(null);
  const [backingUp, setBackingUp] = useState(false);

  const load = () => Promise.all([
    api.get("/settings"), api.get("/system/diagnostics"),
  ]).then(([settingsResponse, diagnosticsResponse]) => {
    setLists(settingsResponse.data || []);
    setDiagnostics(diagnosticsResponse.data);
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
