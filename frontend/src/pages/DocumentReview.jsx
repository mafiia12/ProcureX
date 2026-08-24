import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FilePlus2,
  Files,
  RefreshCw,
  Save,
  Scissors,
  Trash2,
  XCircle,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePreferences } from "@/contexts/PreferencesContext";
import { documentError, internalDocumentApi } from "@/lib/documentCaptureApi";

const terminal = new Set([
  "review_required",
  "confirmed",
  "failed",
  "cancelled",
]);
const rowPayload = (row) => ({
  product_name: row.product_name,
  brand: row.brand,
  specification: row.specification,
  size: row.size,
  quantity: row.quantity === "" ? null : Number(row.quantity),
  unit: row.unit,
  notes: row.notes,
});

export default function DocumentReview() {
  const { requestId, documentId } = useParams();
  const { direction, language, t } = usePreferences();
  const BackIcon = direction === "rtl" ? ArrowRight : ArrowLeft;
  const [document, setDocument] = useState(null);
  const [items, setItems] = useState([]);
  const [mergeIds, setMergeIds] = useState([]);
  const [actor, setActor] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await internalDocumentApi.get(
        `/${requestId}/documents/${documentId}`,
      );
      setDocument(data);
      setItems(data.items || []);
    } catch (error) {
      toast.error(documentError(error));
    }
  }, [requestId, documentId]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!document || terminal.has(document.status)) return undefined;
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [document, load]);

  const update = (id, key, value) =>
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, [key]: value } : item,
      ),
    );
  const saveRow = async (row, notify = true) => {
    await internalDocumentApi.patch(
      `/${requestId}/documents/${documentId}/items/${row.id}`,
      {
        ...rowPayload(row),
        selected_item_id: row.selected_item_id || null,
        excluded: row.excluded,
        review_notes: row.review_notes,
      },
    );
    if (notify) toast.success(t("review.saved"));
  };
  const act = async (operation) => {
    setBusy(true);
    try {
      await operation();
      await load();
    } catch (error) {
      toast.error(documentError(error));
    } finally {
      setBusy(false);
    }
  };
  const addRow = () =>
    act(() =>
      internalDocumentApi.post(`/${requestId}/documents/${documentId}/items`, {
        product_name: language === "ar" ? "صنف جديد" : "New item",
        quantity: null,
        unit: "",
      }),
    );
  const deleteRow = (row) =>
    act(() =>
      internalDocumentApi.delete(
        `/${requestId}/documents/${documentId}/items/${row.id}`,
      ),
    );
  const splitRow = (row) => {
    const quantity = Number(row.quantity || 0);
    const first = {
      ...rowPayload(row),
      quantity: quantity > 0 ? quantity / 2 : null,
    };
    const second = { ...first };
    return act(() =>
      internalDocumentApi.post(
        `/${requestId}/documents/${documentId}/items/${row.id}/split`,
        { first, second },
      ),
    );
  };
  const mergeRows = () => {
    if (mergeIds.length < 2) {
      toast.error(t("review.selectTwo"));
      return;
    }
    act(async () => {
      await internalDocumentApi.post(
        `/${requestId}/documents/${documentId}/items/merge`,
        { item_ids: mergeIds },
      );
      setMergeIds([]);
    });
  };
  const requestMaster = (row) => {
    if (!actor.trim() || !window.confirm(t("review.confirmMasterRequest")))
      return;
    act(async () => {
      await internalDocumentApi.post(
        `/${requestId}/documents/${documentId}/items/${row.id}/master-creation-request`,
        {
          requested_by: actor.trim(),
          confirmation: "REQUEST_MASTER_ITEM_CREATION",
        },
      );
      toast.success(t("review.masterRequested"));
    });
  };
  const confirm = () => {
    if (!confirmed || !actor.trim()) return;
    act(async () => {
      await Promise.all(items.map((row) => saveRow(row, false)));
      await internalDocumentApi.post(
        `/${requestId}/documents/${documentId}/confirm`,
        {
          confirmed_by: actor.trim(),
          confirmation: "CONFIRM_REVIEWED_ITEMS",
        },
      );
      toast.success(t("review.confirmed"));
    });
  };
  const retry = () =>
    act(() =>
      internalDocumentApi.post(`/${requestId}/documents/${documentId}/retry`),
    );
  const cancel = () =>
    act(async () => {
      await internalDocumentApi.post(
        `/${requestId}/documents/${documentId}/cancel`,
      );
      toast.success(t("review.cancelled"));
    });
  const openFile = async (file) => {
    try {
      const { data } = await internalDocumentApi.get(
        `/${requestId}/documents/${documentId}/files/${file.id}`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(data);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      toast.error(documentError(error));
    }
  };

  if (!document)
    return (
      <div className="py-16 text-center text-muted-foreground">
        {t("review.loading")}
      </div>
    );
  return (
    <div
      className="mx-auto max-w-6xl space-y-4"
      data-testid="document-review-page"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{t("review.title")}</h2>
          <Badge variant="outline" className="mt-2">
            {t("review.status")}: {t(`review.states.${document.status}`)}
          </Badge>
        </div>
        <Button asChild variant="outline">
          <Link to="/incoming-requests">
            <BackIcon className="me-2 h-4 w-4" />
            {t("review.back")}
          </Link>
        </Button>
      </div>

      {!!document.files?.length && (
        <section className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 font-bold">{t("review.preview")}</h3>
          <div className="flex flex-wrap gap-2">
            {document.files.map((file) => (
              <Button
                key={file.id}
                variant="outline"
                onClick={() => openFile(file)}
              >
                <Files className="me-2 h-4 w-4" />
                <span
                  className="max-w-64 truncate"
                  title={file.original_filename}
                >
                  {file.original_filename}
                </span>
              </Button>
            ))}
          </div>
        </section>
      )}

      {document.status === "failed" && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <b>{t("review.failed")}</b>
          <p className="mt-1 text-sm">{document.failure_message}</p>
          <Button className="mt-3" variant="outline" onClick={retry}>
            <RefreshCw className="me-2 h-4 w-4" />
            {t("review.retry")}
          </Button>
        </div>
      )}
      {["uploaded", "processing"].includes(document.status) && (
        <div className="rounded-lg border bg-card p-8 text-center">
          <RefreshCw className="mx-auto h-7 w-7 animate-spin text-primary" />
          <p className="mt-3">{t("review.processing")}</p>
          <Button className="mt-4" variant="outline" onClick={cancel}>
            <XCircle className="me-2 h-4 w-4" />
            {t("review.cancel")}
          </Button>
        </div>
      )}

      {document.status === "review_required" && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={addRow}>
            <FilePlus2 className="me-2 h-4 w-4" />
            {t("review.add")}
          </Button>
          <Button variant="outline" onClick={mergeRows}>
            <Files className="me-2 h-4 w-4" />
            {t("review.merge")}
          </Button>
          <Button variant="outline" onClick={retry}>
            <RefreshCw className="me-2 h-4 w-4" />
            {t("review.reprocess")}
          </Button>
          <Button variant="outline" onClick={cancel}>
            <XCircle className="me-2 h-4 w-4" />
            {t("review.cancel")}
          </Button>
        </div>
      )}
      {document.status === "review_required" && !items.length && (
        <div className="rounded-lg border bg-card p-10 text-center text-muted-foreground">
          {t("review.noRows")}
        </div>
      )}

      {items.map((row) => (
        <section
          key={row.id}
          className={`rounded-xl border bg-card p-4 shadow-sm ${row.excluded ? "opacity-60" : ""}`}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={mergeIds.includes(row.id)}
                onCheckedChange={(value) =>
                  setMergeIds((current) =>
                    value
                      ? [...current, row.id]
                      : current.filter((id) => id !== row.id),
                  )
                }
              />
              #{row.position} · {t("review.selectForMerge")}
            </label>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">
                {t("review.confidence")}:{" "}
                {row.extraction_confidence == null
                  ? "—"
                  : `${Math.round(row.extraction_confidence * 100)}%`}
              </Badge>
              <Badge>{t(`review.states.${row.match_state}`)}</Badge>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {row.validation?.missing_product && (
              <Badge variant="destructive">{t("review.missingProduct")}</Badge>
            )}
            {row.validation?.missing_quantity && (
              <Badge variant="destructive">{t("review.missingQuantity")}</Badge>
            )}
            {row.validation?.missing_unit && (
              <Badge variant="destructive">{t("review.missingUnit")}</Badge>
            )}
            {row.validation?.suspected_duplicate && (
              <Badge className="bg-amber-500 text-white">
                {t("review.duplicate")}
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1 lg:col-span-2">
              <Label>{t("review.product")}</Label>
              <Input
                value={row.product_name}
                onChange={(e) => update(row.id, "product_name", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("review.brand")}</Label>
              <Input
                value={row.brand}
                onChange={(e) => update(row.id, "brand", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("review.size")}</Label>
              <Input
                value={row.size}
                onChange={(e) => update(row.id, "size", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("review.quantity")}</Label>
              <Input
                type="number"
                min="0.000001"
                step="any"
                value={row.quantity ?? ""}
                onChange={(e) => update(row.id, "quantity", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("review.unit")}</Label>
              <Input
                value={row.unit}
                onChange={(e) => update(row.id, "unit", e.target.value)}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>{t("review.match")}</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={row.selected_item_id || ""}
                onChange={(e) =>
                  update(row.id, "selected_item_id", e.target.value)
                }
              >
                <option value="">{t("review.noMatch")}</option>
                {row.candidates.map((candidate) => (
                  <option key={candidate.item_id} value={candidate.item_id}>
                    {candidate.code} — {candidate.name_ar || candidate.name_en}{" "}
                    ({Math.round(candidate.score * 100)}%)
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>{t("review.specs")}</Label>
              <Textarea
                rows={2}
                value={row.specification}
                onChange={(e) =>
                  update(row.id, "specification", e.target.value)
                }
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>{t("review.notes")}</Label>
              <Textarea
                rows={2}
                value={row.notes}
                onChange={(e) => update(row.id, "notes", e.target.value)}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>{t("review.reviewNotes")}</Label>
              <Textarea
                rows={2}
                value={row.review_notes}
                onChange={(e) => update(row.id, "review_notes", e.target.value)}
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={row.excluded}
                onCheckedChange={(value) =>
                  update(row.id, "excluded", Boolean(value))
                }
              />
              {t("review.exclude")}
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => requestMaster(row)}>
                {t("review.masterRequest")}
              </Button>
              <Button variant="outline" onClick={() => splitRow(row)}>
                <Scissors className="me-2 h-4 w-4" />
                {t("review.split")}
              </Button>
              <Button variant="outline" onClick={() => deleteRow(row)}>
                <Trash2 className="me-2 h-4 w-4" />
                {t("review.delete")}
              </Button>
              <Button
                variant="outline"
                onClick={() => act(() => saveRow(row))}
                disabled={busy}
              >
                <Save className="me-2 h-4 w-4" />
                {t("review.save")}
              </Button>
            </div>
          </div>
        </section>
      ))}
      {document.raw_text && (
        <details className="rounded-lg border bg-card p-4">
          <summary className="cursor-pointer font-medium">
            {t("review.rawText")}
          </summary>
          <pre
            className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs"
            dir="auto"
          >
            {document.raw_text}
          </pre>
        </details>
      )}
      {document.status === "review_required" && (
        <div className="sticky bottom-0 rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <Input
              placeholder={t("review.actor")}
              value={actor}
              onChange={(e) => setActor(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(value) => setConfirmed(Boolean(value))}
              />
              {t("review.confirmPrompt")}
            </label>
            <Button
              onClick={confirm}
              disabled={busy || !confirmed || !actor.trim()}
            >
              <CheckCircle2 className="me-2 h-4 w-4" />
              {t("review.confirm")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
