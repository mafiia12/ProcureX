import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ChevronDown, Eye, X } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ActionMenu, EmptyState, PageHeader, SearchInput } from "@/components/procurement-ui";
import { usePreferences } from "@/contexts/PreferencesContext";
import { cn } from "@/lib/utils";

export default function CrudPage({
  title,
  endpoint,
  columns,
  fields,
  advancedFields = [],
  filters = [],
  renderDrawer = null,
  testPrefix,
  primaryField = "name",
  rowAction = null,
  listParams = null,
  heading = null,
  description = null,
  searchPlaceholder = "بحث...",
  emptyTitle = "لا توجد سجلات حتى الآن",
  emptyDescription = "ابدأ بإضافة أول سجل؛ ستظهر البيانات هنا تلقائيًا.",
  compactManagement = false,
}) {
  const preferences = usePreferences();
  const language = preferences.language || "ar";
  const tr = preferences.tr || ((ar, en) => (language === "en" ? en : ar));
  const direction = preferences.direction || (language === "en" ? "ltr" : "rtl");
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState({});
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [drawerRow, setDrawerRow] = useState(null);
  const fieldRefs = useRef({});
  const allFields = useMemo(() => [...fields, ...advancedFields], [fields, advancedFields]);
  const advancedKeys = useMemo(() => new Set(advancedFields.map((f) => f.key)), [advancedFields]);

  const load = async () => {
    try {
      const { data } = listParams
        ? await api.get(`/${endpoint}`, { params: listParams })
        : await api.get(`/${endpoint}`);
      setRows(data);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const filterOptions = useMemo(() => {
    const map = {};
    filters.forEach((filter) => {
      if (filter.options) {
        map[filter.key] = filter.options;
        return;
      }
      const unique = Array.from(
        new Set(rows.map((r) => String(r[filter.key] ?? "").trim()).filter(Boolean)),
      ).sort();
      map[filter.key] = unique.map((v) => ({ value: v, label: v }));
    });
    return map;
  }, [filters, rows]);

  const filtered = useMemo(() => {
    let result = rows;
    const activeFilters = filters.filter((f) => filterValues[f.key]);
    if (activeFilters.length) {
      result = result.filter((r) =>
        activeFilters.every((f) => String(r[f.key] ?? "") === filterValues[f.key])
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((r) =>
        columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(q))
      );
    }
    return result;
  }, [rows, search, columns, filters, filterValues]);
  const hasActiveFilters = Boolean(search.trim()) || Object.values(filterValues).some(Boolean);
  const clearFilters = () => {
    setSearch("");
    setFilterValues({});
  };

  const openNew = () => {
    setEditing(null);
    setForm(Object.fromEntries(allFields.map((f) => [f.key, f.default ?? ""])));
    setErrors({});
    setAdvancedOpen(false);
    setOpen(true);
  };
  const openEdit = (row) => {
    setEditing(row);
    setForm({
      code: row.code ?? "",
      ...Object.fromEntries(allFields.map((f) => [f.key, row[f.key] ?? ""])),
    });
    setErrors({});
    setAdvancedOpen(advancedFields.some((f) => String(row[f.key] ?? "").trim() !== ""));
    setOpen(true);
  };

  const fieldLabel = (field) => tr(field.label, field.labelEn || field.label);
  const requiredMessage = (field) => tr(`${field.label} مطلوب`, `${field.labelEn || field.label} is required`);
  const validateField = (field, value) => (
    field.required && !String(value || "").trim() ? requiredMessage(field) : ""
  );
  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field.key]: value }));
    setErrors((current) => {
      if (!current[field.key] || validateField(field, value)) return current;
      const next = { ...current };
      delete next[field.key];
      return next;
    });
  };
  const validate = () => {
    const nextErrors = {};
    allFields.forEach((field) => {
      const message = validateField(field, form[field.key]);
      if (message) nextErrors[field.key] = message;
    });
    setErrors(nextErrors);
    const firstInvalid = allFields.find((field) => nextErrors[field.key]);
    if (firstInvalid && advancedKeys.has(firstInvalid.key)) {
      setAdvancedOpen(true);
    } else {
      fieldRefs.current[firstInvalid?.key]?.focus();
    }
    return Object.keys(nextErrors).length === 0;
  };

  const save = async () => {
    if (!validate()) {
      const field = allFields.find((item) => validateField(item, form[item.key]));
      toast.error(field ? requiredMessage(field) : tr("يرجى مراجعة الحقول المطلوبة", "Review the required fields"));
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form };
      delete payload.code;
      if (editing) {
        await api.put(`/${endpoint}/${editing.id}`, payload);
        toast.success(tr("تم تحديث السجل بنجاح", "Record updated successfully"));
      } else {
        await api.post(`/${endpoint}`, payload);
        toast.success(tr("تم إضافة السجل بنجاح", "Record added successfully"));
      }
      setOpen(false);
      load();
    } catch (e) {
      const message = errMsg(e);
      if ([409, 422].includes(e?.response?.status)) {
        setErrors((current) => ({ ...current, [primaryField]: message }));
        fieldRefs.current[primaryField]?.focus();
      }
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    try {
      await api.delete(`/${endpoint}/${deleting.id}`);
      toast.success(tr("تم حذف السجل", "Record deleted"));
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const renderField = (f) => (
    <div key={f.key} className={f.type === "textarea" ? "md:col-span-2 space-y-1.5" : "space-y-1.5"}>
      <Label htmlFor={`${testPrefix}-form-${f.key}`} className="text-xs">
        {fieldLabel(f)}{f.required ? " *" : ""}
      </Label>
      {f.type === "select" ? (
        <Select value={String(form[f.key] || "")} onValueChange={(value) => updateField(f, value)}>
          <SelectTrigger
            id={`${testPrefix}-form-${f.key}`}
            ref={(node) => { fieldRefs.current[f.key] = node; }}
            data-testid={`${testPrefix}-form-${f.key}`}
            aria-required={f.required || undefined}
            aria-invalid={!!errors[f.key]}
            aria-describedby={errors[f.key] ? `${testPrefix}-form-${f.key}-error` : undefined}
            className={errors[f.key] ? "border-red-500 focus:ring-red-500" : undefined}
            onBlur={() => {
              const message = validateField(f, form[f.key]);
              if (message) setErrors((current) => ({ ...current, [f.key]: message }));
            }}
          >
            <SelectValue placeholder={fieldLabel(f)} />
          </SelectTrigger>
          <SelectContent dir={direction}>
            {(f.options || []).map((o) => (
              <SelectItem key={o} value={String(o)}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : f.type === "textarea" ? (
        <Textarea
          id={`${testPrefix}-form-${f.key}`}
          ref={(node) => { fieldRefs.current[f.key] = node; }}
          data-testid={`${testPrefix}-form-${f.key}`}
          value={form[f.key] || ""}
          aria-required={f.required || undefined}
          aria-invalid={!!errors[f.key]}
          aria-describedby={errors[f.key] ? `${testPrefix}-form-${f.key}-error` : undefined}
          className={errors[f.key] ? "border-red-500 focus-visible:ring-red-500" : undefined}
          onChange={(event) => updateField(f, event.target.value)}
          onBlur={() => {
            const message = validateField(f, form[f.key]);
            if (message) setErrors((current) => ({ ...current, [f.key]: message }));
          }}
          rows={2}
        />
      ) : (
        <Input
          id={`${testPrefix}-form-${f.key}`}
          ref={(node) => { fieldRefs.current[f.key] = node; }}
          data-testid={`${testPrefix}-form-${f.key}`}
          type={f.type || "text"}
          value={form[f.key] || ""}
          readOnly={f.readOnly}
          tabIndex={f.readOnly ? -1 : undefined}
          aria-required={f.required || undefined}
          aria-invalid={!!errors[f.key]}
          aria-describedby={errors[f.key] ? `${testPrefix}-form-${f.key}-error` : undefined}
          className={f.readOnly
            ? "bg-muted text-muted-foreground"
            : errors[f.key] ? "border-red-500 focus-visible:ring-red-500" : undefined}
          onChange={(event) => updateField(f, event.target.value)}
          onBlur={() => {
            const message = validateField(f, form[f.key]);
            if (message) setErrors((current) => ({ ...current, [f.key]: message }));
          }}
        />
      )}
      {errors[f.key] && (
        <p
          id={`${testPrefix}-form-${f.key}-error`}
          className="text-xs text-red-600 text-start"
          role="alert"
        >
          {errors[f.key]}
        </p>
      )}
    </div>
  );

  const closeDrawer = () => setDrawerRow(null);
  const drawerHelpers = {
    tr,
    direction,
    close: closeDrawer,
    edit: (row) => { closeDrawer(); openEdit(row); },
    reload: load,
  };

  return (
    <div className={cn("space-y-4", compactManagement && "space-y-2.5")} data-testid={`${testPrefix}-page`}>
      {compactManagement ? <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2" data-testid={`${testPrefix}-management-header`}>
        <div className="min-w-0"><h1 className="text-base font-bold tracking-tight text-foreground">{heading || title}</h1>{description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>}</div>
        <div className="flex items-center gap-2"><span className="text-[10.5px] text-muted-foreground">{tr("السجلات", "Records")}: <b className="text-foreground tabular-nums">{rows.length}</b></span><Button size="sm" className="h-8 gap-1.5" data-testid={`${testPrefix}-add-button`} onClick={openNew}><Plus className="h-3.5 w-3.5" /> {tr("إضافة", "Add")} {title}</Button></div>
      </div> : <PageHeader
        title={heading || title}
        description={description}
        actions={<Button data-testid={`${testPrefix}-add-button`} onClick={openNew} className="gap-2"><Plus className="h-4 w-4" /> {tr("إضافة", "Add")} {title}</Button>}
      />}
      <div className={cn("flex flex-wrap items-center gap-2", compactManagement && "border bg-card p-2")} data-testid={`${testPrefix}-management-toolbar`}>
        <SearchInput data-testid={`${testPrefix}-search-input`} className={cn("w-full sm:w-80", compactManagement && "h-8 sm:min-w-80 sm:flex-1")} placeholder={searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
        {filters.map((filter) => (
          <select
            key={filter.key}
            data-testid={`${testPrefix}-filter-${filter.key}`}
            className={cn("h-8 rounded-md border border-input bg-background px-2.5 text-sm text-foreground", compactManagement && "text-xs")}
            value={filterValues[filter.key] || ""}
            onChange={(e) => setFilterValues((current) => ({ ...current, [filter.key]: e.target.value }))}
          >
            <option value="">{filter.allLabel || tr("الكل", "All")}</option>
            {(filterOptions[filter.key] || []).map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        ))}
        {compactManagement && hasActiveFilters && <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" onClick={clearFilters} data-testid={`${testPrefix}-clear-filters`}><X className="h-3.5 w-3.5" />{tr("مسح", "Clear")}</Button>}
        {compactManagement && <span className="ms-auto text-[10.5px] text-muted-foreground">{tr("ظاهر", "Showing")} <b className="text-foreground tabular-nums">{filtered.length}</b> / {rows.length}</span>}
      </div>

      <div className={cn("overflow-auto border bg-card", compactManagement ? "max-h-[calc(100dvh-190px)] rounded-md" : "max-h-[calc(100vh-240px)] rounded-lg")}>
        <Table>
          <TableHeader className="sticky top-0 z-10">
            <TableRow className={cn("bg-muted/90", compactManagement && "h-8")}>
              {columns.map((c) => (
                <TableHead
                  key={c.key}
                  className={cn("whitespace-nowrap text-start text-[11px] font-bold uppercase tracking-wide text-muted-foreground", compactManagement && "h-8 px-2", c.hideOnMobile && "hidden md:table-cell")}
                >
                  {c.label}
                </TableHead>
              ))}
              <TableHead className={cn("w-24 text-start text-[11px] font-bold uppercase tracking-wide text-muted-foreground", compactManagement && "h-8 px-2")}>{tr("إجراءات", "Actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="p-0"><EmptyState compact={compactManagement} title={emptyTitle} description={emptyDescription} action={<Button size="sm" onClick={openNew}><Plus className="h-4 w-4" /> {tr("إضافة", "Add")} {title}</Button>} /></TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(compactManagement ? "h-8 hover:bg-muted/40" : "h-9 hover:bg-muted/50", renderDrawer && "cursor-pointer")}
                  data-testid={`${testPrefix}-row`}
                  onClick={renderDrawer ? () => setDrawerRow(row) : undefined}
                >
                  {columns.map((c) => {
                    const value = c.render ? c.render(row) : (row[c.key] ?? "-") || "-";
                    return (
                      <TableCell
                        key={c.key}
                        className={cn(
                          compactManagement ? "px-2 py-0.5 text-xs" : "py-1 text-sm",
                          c.hideOnMobile && "hidden md:table-cell",
                          c.truncate ? "max-w-[220px] truncate" : "whitespace-nowrap",
                          c.className,
                        )}
                        dir={c.ltr ? "ltr" : undefined}
                        title={c.truncate && typeof value === "string" ? value : undefined}
                      >
                        {value}
                      </TableCell>
                    );
                  })}
                  <TableCell className={compactManagement ? "px-2 py-0.5" : "py-1.5"} onClick={(e) => e.stopPropagation()}>
                    <ActionMenu
                      testId={`${testPrefix}-actions`}
                      actions={[
                        renderDrawer && { label: tr("عرض التفاصيل", "View details"), icon: <Eye className="me-2 h-3.5 w-3.5" />, onSelect: () => setDrawerRow(row), testId: `${testPrefix}-view-button` },
                        rowAction && { label: rowAction.label, onSelect: () => rowAction.onClick(row), testId: `${testPrefix}-row-action` },
                        { label: tr("تعديل", "Edit"), icon: <Pencil className="me-2 h-3.5 w-3.5" />, onSelect: () => openEdit(row), testId: `${testPrefix}-edit-button` },
                        { label: tr("حذف", "Delete"), icon: <Trash2 className="me-2 h-3.5 w-3.5" />, destructive: true, onSelect: () => setDeleting(row), testId: `${testPrefix}-delete-button` },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {!compactManagement && <div className="text-xs text-muted-foreground">{tr("إجمالي السجلات", "Total records")}: {filtered.length}</div>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          dir={direction}
          className="max-w-2xl max-h-[85vh] overflow-y-auto"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const firstEditable = fields.find((field) => !field.readOnly);
            fieldRefs.current[firstEditable?.key]?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-start">{editing ? `${tr("تعديل", "Edit")} ${title}` : `${tr("إضافة", "Add")} ${title}`}</DialogTitle>
            <DialogDescription className="sr-only">
              {tr("أدخل البيانات المطلوبة ثم احفظ السجل", "Enter the required information, then save the record")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {editing?.code && (
              <div className="space-y-1.5">
                <Label htmlFor={`${testPrefix}-form-code`} className="text-xs">{tr("الكود", "Code")}</Label>
                <Input
                  id={`${testPrefix}-form-code`}
                  data-testid={`${testPrefix}-form-code`}
                  value={form.code || ""}
                  readOnly
                  tabIndex={-1}
                  className="bg-muted text-muted-foreground"
                />
              </div>
            )}
            {fields.map(renderField)}
          </div>
          {advancedFields.length > 0 && (
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  data-testid={`${testPrefix}-advanced-toggle`}
                  className="flex w-full items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted"
                >
                  {tr("بيانات إضافية", "Additional details")}
                  <ChevronDown className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                {advancedFields.map(renderField)}
              </CollapsibleContent>
            </Collapsible>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>{tr("إلغاء", "Cancel")}</Button>
            <Button data-testid={`${testPrefix}-save-button`} onClick={save} disabled={saving}>
              {saving ? tr("جارٍ الحفظ...", "Saving...") : tr("حفظ", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent dir={direction}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-start">{tr("تأكيد الحذف", "Confirm deletion")}</AlertDialogTitle>
            <AlertDialogDescription className="text-start">
              {tr(`هل أنت متأكد من حذف "${deleting?.name}"؟ لا يمكن التراجع عن هذا الإجراء.`, `Delete "${deleting?.name}"? This action cannot be undone.`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>{tr("إلغاء", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid={`${testPrefix}-confirm-delete`} onClick={doDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{tr("حذف", "Delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {renderDrawer && (
        <Sheet open={!!drawerRow} onOpenChange={(v) => !v && closeDrawer()}>
          <SheetContent
            side={direction === "rtl" ? "left" : "right"}
            dir={direction}
            className="w-full overflow-y-auto sm:max-w-md"
            data-testid={`${testPrefix}-drawer`}
          >
            <SheetHeader className="text-start">
              <SheetTitle className="sr-only">{drawerRow ? (drawerRow[primaryField] || title) : title}</SheetTitle>
            </SheetHeader>
            {drawerRow && renderDrawer(drawerRow, drawerHelpers)}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
