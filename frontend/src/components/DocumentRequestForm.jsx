import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, FileUp, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePreferences } from "@/contexts/PreferencesContext";
import { documentError, publicDocumentApi } from "@/lib/documentCaptureApi";

const makeToken = () =>
  `${Date.now()}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
const initial = () => ({
  requester_name: "",
  company_name: "",
  phone_number: "",
  project_name: "",
  project_location: "",
  delivery_location: "",
  required_delivery_date: "",
  priority: "normal",
  notes: "",
  document_type: "handwritten_request",
});

const Field = ({ label, required, children, className = "" }) => (
  <div className={`space-y-1 ${className}`}>
    <Label className="text-xs text-muted-foreground">
      {label}
      {required && " *"}
    </Label>
    {children}
  </div>
);

export default function DocumentRequestForm() {
  const { t } = usePreferences();
  const [form, setForm] = useState(initial);
  const [files, setFiles] = useState([]);
  const [capability, setCapability] = useState(null);
  const [token, setToken] = useState(makeToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null);
  const cameraRef = useRef(null);
  const pickerRef = useRef(null);
  const minDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    publicDocumentApi
      .get("/document-extraction-capability")
      .then(({ data }) => setCapability(data))
      .catch(() => setCapability({ available: false, status: "unavailable" }));
  }, []);

  const addFiles = (incoming) =>
    setFiles((current) =>
      [...current, ...Array.from(incoming || [])].slice(0, 10),
    );
  const set = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (
      !form.requester_name.trim() ||
      !form.phone_number.trim() ||
      !form.project_name.trim() ||
      !form.project_location.trim() ||
      !form.delivery_location.trim() ||
      !form.required_delivery_date ||
      !files.length
    ) {
      setError(t("document.required"));
      return;
    }
    setBusy(true);
    setError("");
    const body = new FormData();
    body.append(
      "payload",
      JSON.stringify({ ...form, submission_token: token }),
    );
    body.append("website", "");
    files.forEach((file) => body.append("documents", file));
    try {
      const { data } = await publicDocumentApi.post("/documents", body);
      setSuccess(data);
    } catch (requestError) {
      setError(documentError(requestError));
    } finally {
      setBusy(false);
    }
  };

  if (success)
    return (
      <div className="rounded-2xl border border-emerald-200 bg-card p-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
        <h2 className="mt-4 text-xl font-bold">{t("document.success")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("document.privacy")}
        </p>
        <div className="mx-auto mt-5 max-w-sm rounded-xl bg-emerald-50 px-4 py-4 dark:bg-emerald-950/40">
          <div className="text-xs text-muted-foreground">
            {t("document.reference")}
          </div>
          <div className="mt-1 text-xl font-bold tracking-wide">
            {success.request_number}
          </div>
        </div>
        <Button
          variant="outline"
          className="mt-6"
          onClick={() => {
            setForm(initial());
            setFiles([]);
            setToken(makeToken());
            setSuccess(null);
          }}
        >
          {t("document.another")}
        </Button>
      </div>
    );

  const unavailable = capability && !capability.available;
  return (
    <form
      onSubmit={submit}
      className="space-y-4"
      noValidate
      data-testid="document-request-form"
    >
      {unavailable && (
        <div
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
          role="status"
        >
          {capability.status === "configuration_required"
            ? t("document.configRequired")
            : t("document.unavailable")}
        </div>
      )}
      <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t("document.requester")} required>
            <Input
              autoFocus
              value={form.requester_name}
              onChange={(e) => set("requester_name", e.target.value)}
            />
          </Field>
          <Field label={t("document.company")}>
            <Input
              value={form.company_name}
              onChange={(e) => set("company_name", e.target.value)}
            />
          </Field>
          <Field label={t("document.phone")} required>
            <Input
              type="tel"
              value={form.phone_number}
              onChange={(e) => set("phone_number", e.target.value)}
            />
          </Field>
          <Field label={t("document.project")} required>
            <Input
              value={form.project_name}
              onChange={(e) => set("project_name", e.target.value)}
            />
          </Field>
          <Field label={t("document.location")} required>
            <Input
              value={form.project_location}
              onChange={(e) => set("project_location", e.target.value)}
            />
          </Field>
          <Field label={t("document.delivery")} required>
            <Input
              value={form.delivery_location}
              onChange={(e) => set("delivery_location", e.target.value)}
            />
          </Field>
          <Field label={t("document.date")} required>
            <Input
              type="date"
              min={minDate}
              value={form.required_delivery_date}
              onChange={(e) => set("required_delivery_date", e.target.value)}
            />
          </Field>
          <Field label={t("document.priority")}>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.priority}
              onChange={(e) => set("priority", e.target.value)}
            >
              {["normal", "high", "urgent", "low"].map((value) => (
                <option key={value} value={value}>
                  {t(`document.priorities.${value}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("document.type")}>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.document_type}
              onChange={(e) => set("document_type", e.target.value)}
            >
              <option value="handwritten_request">
                {t("document.handwritten")}
              </option>
              <option value="printed_request">{t("document.printed")}</option>
              <option value="supplier_quotation">
                {t("document.quotation")}
              </option>
              <option value="supplier_invoice">{t("document.invoice")}</option>
              <option value="supply_order">{t("document.supplyOrder")}</option>
            </select>
          </Field>
          <Field
            label={t("document.notes")}
            className="sm:col-span-2 lg:col-span-3"
          >
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
        <p className="mb-3 text-sm text-muted-foreground">
          {t("document.privacy")}
        </p>
        <p className="mb-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          {t("document.guidance")}
        </p>
        {!["handwritten_request", "printed_request"].includes(
          form.document_type,
        ) && (
          <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            {t("document.retainedOnly")}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <Button
            type="button"
            variant="outline"
            className="min-h-12 gap-2"
            onClick={() => pickerRef.current?.click()}
            disabled={unavailable}
          >
            <FileUp className="h-5 w-5" /> {t("document.choose")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-12 gap-2"
            onClick={() => cameraRef.current?.click()}
            disabled={unavailable}
          >
            <Camera className="h-5 w-5" /> {t("document.camera")}
          </Button>
          <input
            ref={pickerRef}
            className="sr-only"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => addFiles(e.target.files)}
          />
          <input
            ref={cameraRef}
            className="sr-only"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => addFiles(e.target.files)}
          />
        </div>
        {!!files.length && (
          <div className="mt-4 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              {t("document.selected")} ({files.length})
            </div>
            {files.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2 text-sm"
              >
                <span className="truncate" title={file.name}>
                  {file.name}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() =>
                    setFiles((current) => current.filter((_, i) => i !== index))
                  }
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
      {error && (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}
      <div className="sticky bottom-0 flex justify-end border-t bg-background/95 py-3 backdrop-blur">
        <Button
          className="min-h-11 min-w-44 gap-2"
          disabled={busy || unavailable}
        >
          <Send className="h-4 w-4" />{" "}
          {busy ? t("document.sending") : t("document.send")}
        </Button>
      </div>
    </form>
  );
}
