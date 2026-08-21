import {
  ArrowLeft, ArrowRight, FileText, Inbox, MoreHorizontal, Paperclip,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, eyebrow, className }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-semibold text-primary">{eyebrow}</div>}
        <h1 className="text-xl font-bold tracking-tight text-slate-950">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionHeader({ title, description, action, className }) {
  return (
    <div className={cn("mb-3 flex items-start justify-between gap-3", className)}>
      <div>
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
        {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const KPI_TONES = {
  neutral: "bg-slate-50 text-slate-600",
  primary: "bg-primary/10 text-primary",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
  info: "bg-blue-50 text-blue-700",
};

export function KpiCard({ label, value, helper, icon: Icon, tone = "neutral", testId }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3.5" data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-500">{label}</div>
          <div className="mt-1 truncate text-xl font-bold tabular-nums text-slate-950" dir="auto">{value}</div>
          {helper && <div className="mt-1 text-[11px] text-slate-400">{helper}</div>}
        </div>
        {Icon && <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", KPI_TONES[tone])}><Icon className="h-4 w-4" /></div>}
      </div>
    </article>
  );
}

const STATUS_TONES = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  primary: "bg-primary/10 text-primary ring-primary/20",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  info: "bg-blue-50 text-blue-700 ring-blue-200",
};

export function StatusBadge({ children, tone = "neutral", className }) {
  return <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", STATUS_TONES[tone], className)}>{children}</span>;
}

export function ActionButton({ icon: Icon, children, className, ...props }) {
  return <Button className={cn("gap-1.5", className)} {...props}>{Icon && <Icon className="h-4 w-4" />}{children}</Button>;
}

export function EmptyState({ title, description, action, icon: Icon = Inbox, compact = false, className }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/60 text-center", compact ? "px-4 py-7" : "px-6 py-12", className)}>
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-400 ring-1 ring-slate-200"><Icon className="h-5 w-5" /></div>
      <h3 className="mt-3 text-sm font-bold text-slate-800">{title}</h3>
      {description && <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SearchInput({ className, inputClassName, ...props }) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input type="search" className={cn("bg-white ps-9", inputClassName)} {...props} />
    </div>
  );
}

export function FilterBar({ children, resultLabel, onClear, className }) {
  return (
    <section className={cn("rounded-lg border border-slate-200 bg-white p-3", className)}>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {(resultLabel || onClear) && <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-100 pt-2 text-xs text-slate-500"><span>{resultLabel}</span>{onClear && <button type="button" onClick={onClear} className="font-semibold text-primary hover:underline">مسح الفلاتر</button>}</div>}
    </section>
  );
}

export function DataTable({ columns, rows, rowKey = "id", empty, className, tableClassName, sticky = true, rowTestId }) {
  return (
    <div className={cn("overflow-auto rounded-lg border border-slate-200 bg-white", className)}>
      <Table className={cn("min-w-full", tableClassName)}>
        <TableHeader className={sticky ? "sticky top-0 z-10" : undefined}>
          <TableRow className="bg-slate-50/95 hover:bg-slate-50">
            {columns.map((column) => <TableHead key={column.key} className={cn("h-10 whitespace-nowrap text-start text-xs font-bold text-slate-600", column.headerClassName, column.className)}>{column.label}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={typeof rowKey === "function" ? rowKey(row) : row[rowKey] ?? index} className="h-12 border-slate-100 hover:bg-slate-50/70" data-testid={rowTestId}>
              {columns.map((column) => <TableCell key={column.key} className={cn("py-2 text-sm text-slate-700", column.className)}>{column.render ? column.render(row, index) : (row[column.key] ?? "-")}</TableCell>)}
            </TableRow>
          ))}
          {!rows.length && <TableRow><TableCell colSpan={columns.length} className="p-0">{empty || <EmptyState compact title="لا توجد بيانات" description="لا توجد سجلات مطابقة في الوقت الحالي." />}</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}

export function SidePanel({ open, onOpenChange, title, description, children, side = "left", className }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className={cn("w-full overflow-y-auto sm:max-w-xl", className)} dir="rtl">
        <SheetHeader className="text-start"><SheetTitle>{title}</SheetTitle>{description && <SheetDescription>{description}</SheetDescription>}</SheetHeader>
        <div className="mt-5">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export function ConfirmationDialog({ open, onOpenChange, title, description, confirmLabel = "تأكيد", cancelLabel = "إلغاء", destructive = false, onConfirm, children }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent dir="rtl"><AlertDialogHeader><AlertDialogTitle className="text-start">{title}</AlertDialogTitle><AlertDialogDescription className="text-start">{description}</AlertDialogDescription></AlertDialogHeader>{children}<AlertDialogFooter className="gap-2"><AlertDialogCancel>{cancelLabel}</AlertDialogCancel><AlertDialogAction onClick={onConfirm} className={destructive ? "bg-red-700 hover:bg-red-800" : undefined}>{confirmLabel}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  );
}

export function SupplierCard({ title, subtitle, badges, actions, children, footer, className, testId }) {
  return (
    <article className={cn("flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white", className)} data-testid={testId}>
      <header className="border-b border-slate-100 px-4 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-bold text-slate-900">{title}</h3>{subtitle && <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>}</div>{actions}</div>{badges && <div className="mt-2 flex flex-wrap gap-1.5">{badges}</div>}</header>
      <div className="flex-1">{children}</div>
      {footer && <footer className="border-t border-slate-100 p-3">{footer}</footer>}
    </article>
  );
}

export function MoneyDisplay({ value, currency = "ج.م", className }) {
  const amount = Number(value || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <span className={cn("inline-flex whitespace-nowrap font-mono tabular-nums", className)} dir="ltr">{amount} {currency}</span>;
}

export function WorkflowStepper({ stages, steps, currentIndex, currentStep, className }) {
  const workflowStages = stages || steps || [];
  if (!workflowStages.length) return null;
  const requestedIndex = currentIndex ?? currentStep ?? 0;
  const safeIndex = Math.max(0, Math.min(Number(requestedIndex) || 0, workflowStages.length - 1));
  const previous = safeIndex > 0 ? workflowStages[safeIndex - 1] : null;
  const next = safeIndex < workflowStages.length - 1 ? workflowStages[safeIndex + 1] : null;
  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white p-3", className)}>
      <div className="flex items-center justify-between gap-3 text-xs"><div><span className="text-slate-400">المرحلة الحالية</span><div className="mt-0.5 font-bold text-primary">{workflowStages[safeIndex]}</div></div><span className="font-mono text-slate-400" dir="ltr">{safeIndex + 1}/{workflowStages.length}</span></div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${((safeIndex + 1) / workflowStages.length) * 100}%` }} /></div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-slate-400"><span>{previous ? <><ArrowRight className="me-1 inline h-3 w-3" />{previous}</> : "بداية المسار"}</span><span className="text-end">{next ? <>{next}<ArrowLeft className="ms-1 inline h-3 w-3" /></> : "اكتمل المسار"}</span></div>
    </div>
  );
}

export function AttachmentBlock({ title = "المرفقات", attachments = [], onView, onUpload, accept = ".pdf,.xls,.xlsx,.jpg,.jpeg,.png,.webp", canUpload = false, helper }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs font-bold text-slate-700"><Paperclip className="h-4 w-4" />{title}</div>{canUpload && <label className="cursor-pointer rounded-md border bg-white px-2 py-1 text-[11px] font-semibold text-primary hover:bg-slate-50">رفع / استبدال<input type="file" className="sr-only" accept={accept} multiple onChange={(event) => onUpload?.(Array.from(event.target.files || []))} /></label>}</div>
      {helper && <p className="mt-1 text-[11px] text-slate-400">{helper}</p>}
      <div className="mt-2 space-y-1.5">{attachments.map((file) => <button key={file.id || file.original_filename} type="button" onClick={() => onView?.(file)} className="flex w-full items-center justify-between gap-2 rounded-md bg-white px-2.5 py-2 text-start text-xs ring-1 ring-slate-200 hover:ring-primary/30"><span className="min-w-0 truncate"><FileText className="me-1.5 inline h-3.5 w-3.5 text-slate-400" />{file.original_filename || file.name}</span><span className="text-primary">عرض</span></button>)}{!attachments.length && <div className="rounded-md border border-dashed bg-white p-3 text-center text-[11px] text-slate-400">لا يوجد مرفق لعرض المورد.</div>}</div>
    </div>
  );
}

export function ActionMenu({ actions, label = "إجراءات", testId }) {
  return (
    <DropdownMenu dir="rtl"><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label={label} data-testid={testId}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{actions.filter(Boolean).map((action) => <DropdownMenuItem key={action.label} disabled={action.disabled} onSelect={action.onSelect} className={action.destructive ? "text-red-700 focus:text-red-700" : undefined} data-testid={action.testId}>{action.icon}{action.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
  );
}
