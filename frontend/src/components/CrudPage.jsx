import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ActionMenu, EmptyState, PageHeader, SearchInput } from "@/components/procurement-ui";

export default function CrudPage({
  title,
  endpoint,
  columns,
  fields,
  testPrefix,
  primaryField = "name",
  rowAction = null,
  listParams = null,
  heading = null,
  description = null,
  searchPlaceholder = "بحث...",
  emptyTitle = "لا توجد سجلات حتى الآن",
  emptyDescription = "ابدأ بإضافة أول سجل؛ ستظهر البيانات هنا تلقائيًا.",
}) {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const fieldRefs = useRef({});

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

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) =>
      columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(q))
    );
  }, [rows, search, columns]);

  const openNew = () => {
    setEditing(null);
    setForm(Object.fromEntries(fields.map((f) => [f.key, f.default ?? ""])));
    setErrors({});
    setOpen(true);
  };
  const openEdit = (row) => {
    setEditing(row);
    setForm({
      code: row.code ?? "",
      ...Object.fromEntries(fields.map((f) => [f.key, row[f.key] ?? ""])),
    });
    setErrors({});
    setOpen(true);
  };

  const requiredMessage = (field) => `${field.label} مطلوب`;
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
    fields.forEach((field) => {
      const message = validateField(field, form[field.key]);
      if (message) nextErrors[field.key] = message;
    });
    setErrors(nextErrors);
    const firstInvalid = fields.find((field) => nextErrors[field.key]);
    fieldRefs.current[firstInvalid?.key]?.focus();
    return Object.keys(nextErrors).length === 0;
  };

  const save = async () => {
    if (!validate()) {
      const field = fields.find((item) => validateField(item, form[item.key]));
      toast.error(field ? requiredMessage(field) : "يرجى مراجعة الحقول المطلوبة");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form };
      delete payload.code;
      if (editing) {
        await api.put(`/${endpoint}/${editing.id}`, payload);
        toast.success("تم تحديث السجل بنجاح");
      } else {
        await api.post(`/${endpoint}`, payload);
        toast.success("تم إضافة السجل بنجاح");
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
      toast.success("تم حذف السجل");
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4" data-testid={`${testPrefix}-page`}>
      <PageHeader
        title={heading || title}
        description={description}
        actions={<Button data-testid={`${testPrefix}-add-button`} onClick={openNew} className="gap-2"><Plus className="h-4 w-4" /> إضافة {title}</Button>}
      />
      <SearchInput data-testid={`${testPrefix}-search-input`} className="w-full sm:w-80" placeholder={searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />

      <div className="max-h-[calc(100vh-240px)] overflow-auto rounded-lg border border-slate-200 bg-white">
        <Table>
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="bg-slate-50">
              {columns.map((c) => (
                <TableHead key={c.key} className="text-start text-xs font-bold text-slate-600 whitespace-nowrap">
                  {c.label}
                </TableHead>
              ))}
              <TableHead className="text-start text-xs font-bold text-slate-600 w-24">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="p-0"><EmptyState title={emptyTitle} description={emptyDescription} action={<Button size="sm" onClick={openNew}><Plus className="h-4 w-4" /> إضافة {title}</Button>} /></TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <TableRow key={row.id} className="hover:bg-slate-50" data-testid={`${testPrefix}-row`}>
                  {columns.map((c) => (
                    <TableCell key={c.key} className="py-2 text-sm whitespace-nowrap">
                      {c.render ? c.render(row) : (row[c.key] ?? "-") || "-"}
                    </TableCell>
                  ))}
                  <TableCell className="py-2">
                    <ActionMenu
                      testId={`${testPrefix}-actions`}
                      actions={[
                        rowAction && { label: rowAction.label, onSelect: () => rowAction.onClick(row), testId: `${testPrefix}-row-action` },
                        { label: "تعديل", icon: <Pencil className="me-2 h-3.5 w-3.5" />, onSelect: () => openEdit(row), testId: `${testPrefix}-edit-button` },
                        { label: "حذف", icon: <Trash2 className="me-2 h-3.5 w-3.5" />, destructive: true, onSelect: () => setDeleting(row), testId: `${testPrefix}-delete-button` },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="text-xs text-slate-500">إجمالي السجلات: {filtered.length}</div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          dir="rtl"
          className="max-w-2xl max-h-[85vh] overflow-y-auto"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const firstEditable = fields.find((field) => !field.readOnly);
            fieldRefs.current[firstEditable?.key]?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-start">{editing ? `تعديل ${title}` : `إضافة ${title}`}</DialogTitle>
            <DialogDescription className="sr-only">
              أدخل البيانات المطلوبة ثم احفظ السجل
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {editing?.code && (
              <div className="space-y-1.5">
                <Label htmlFor={`${testPrefix}-form-code`} className="text-xs">الكود</Label>
                <Input
                  id={`${testPrefix}-form-code`}
                  data-testid={`${testPrefix}-form-code`}
                  value={form.code || ""}
                  readOnly
                  tabIndex={-1}
                  className="bg-slate-50 text-slate-500"
                />
              </div>
            )}
            {fields.map((f) => (
              <div key={f.key} className={f.type === "textarea" ? "md:col-span-2 space-y-1.5" : "space-y-1.5"}>
                <Label htmlFor={`${testPrefix}-form-${f.key}`} className="text-xs">
                  {f.label}{f.required ? " *" : ""}
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
                      <SelectValue placeholder={f.label} />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
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
                      ? "bg-slate-50 text-slate-500"
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
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button data-testid={`${testPrefix}-save-button`} onClick={save} disabled={saving}>
              {saving ? "جارٍ الحفظ..." : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-start">تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription className="text-start">
              هل أنت متأكد من حذف "{deleting?.name}"؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction data-testid={`${testPrefix}-confirm-delete`} onClick={doDelete}
              className="bg-red-600 hover:bg-red-700">حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
