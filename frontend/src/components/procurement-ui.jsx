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
import { usePreferences } from "@/contexts/PreferencesContext";

const useBilingualPreferences = () => {
  const preferences = usePreferences();
  const language = preferences.language || "ar";
  return {
    ...preferences,
    direction: preferences.direction || (language === "en" ? "ltr" : "rtl"),
    locale: preferences.locale || (language === "en" ? "en-EG" : "ar-EG"),
    tr: preferences.tr || ((arabic, english) => (language === "en" ? english : arabic)),
  };
};

export function PageHeader({ title, description, actions, eyebrow, className }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-semibold text-primary">{eyebrow}</div>}
        <h1 className="text-xl font-bold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionHeader({ title, description, action, className }) {
  return (
    <div className={cn("mb-3 flex items-start justify-between gap-3", className)}>
      <div>
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        {description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const KPI_TONES = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
};

export function KpiCard({ label, value, helper, icon: Icon, tone = "neutral", testId }) {
  return (
    <article className="border bg-card p-3" data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className="mt-1 truncate text-xl font-extrabold tabular-nums text-foreground" dir="auto">{value}</div>
          {helper && <div className="mt-1 text-[11px] text-muted-foreground">{helper}</div>}
        </div>
        {Icon && <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center", KPI_TONES[tone])}><Icon className="h-4 w-4" /></div>}
      </div>
    </article>
  );
}

const STATUS_TONES = {
  neutral: "bg-muted text-muted-foreground border-border",
  primary: "bg-primary/10 text-primary border-primary/25",
  success: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25 dark:text-emerald-300",
  warning: "bg-amber-500/10 text-amber-800 border-amber-500/25 dark:text-amber-300",
  danger: "bg-destructive/10 text-destructive border-destructive/25",
  info: "bg-blue-500/10 text-blue-700 border-blue-500/25 dark:text-blue-300",
};

export function StatusBadge({ children, tone = "neutral", className }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap border px-1.5 py-0.5 text-[10.5px] font-bold leading-none", STATUS_TONES[tone], className)}>
      <span className="h-1 w-1 shrink-0 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}

export function ActionButton({ icon: Icon, children, className, ...props }) {
  return <Button className={cn("gap-1.5", className)} {...props}>{Icon && <Icon className="h-4 w-4" />}{children}</Button>;
}

export function EmptyState({ title, description, action, icon: Icon = Inbox, compact = false, className }) {
  return (
    <div className={cn("flex flex-col items-center justify-center border border-dashed bg-muted/40 text-center", compact ? "px-4 py-5" : "px-6 py-8", className)}>
      <div className="flex h-9 w-9 items-center justify-center border bg-card text-muted-foreground"><Icon className="h-4 w-4" /></div>
      <h3 className="mt-2.5 text-sm font-bold text-foreground">{title}</h3>
      {description && <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SearchInput({ className, inputClassName, ...props }) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input type="search" className={cn("bg-background ps-9", inputClassName)} {...props} />
    </div>
  );
}

export function FilterBar({ children, resultLabel, onClear, className }) {
  const { tr } = useBilingualPreferences();
  return (
    <section className={cn("border bg-card p-2.5", className)}>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {(resultLabel || onClear) && <div className="mt-2 flex items-center justify-between gap-3 border-t pt-2 text-xs text-muted-foreground"><span>{resultLabel}</span>{onClear && <button type="button" onClick={onClear} className="font-semibold text-primary hover:underline">{tr("مسح الفلاتر", "Clear filters")}</button>}</div>}
    </section>
  );
}

export function DataTable({ columns, rows, rowKey = "id", empty, className, tableClassName, sticky = true, rowTestId }) {
  const { tr } = useBilingualPreferences();
  return (
    <div className={cn("overflow-auto border bg-card", className)}>
      <Table className={cn("min-w-full", tableClassName)}>
        <TableHeader className={sticky ? "sticky top-0 z-10" : undefined}>
          <TableRow className="bg-muted/90 hover:bg-muted">
            {columns.map((column) => <TableHead key={column.key} className={cn("h-8 whitespace-nowrap text-start text-[11px] font-bold uppercase tracking-wide text-muted-foreground", column.headerClassName, column.className)}>{column.label}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={typeof rowKey === "function" ? rowKey(row) : row[rowKey] ?? index} className="h-9 hover:bg-muted/50" data-testid={rowTestId}>
              {columns.map((column) => <TableCell key={column.key} className={cn("py-1 text-sm text-foreground", column.className)}>{column.render ? column.render(row, index) : (row[column.key] ?? "-")}</TableCell>)}
            </TableRow>
          ))}
          {!rows.length && <TableRow><TableCell colSpan={columns.length} className="p-0">{empty || <EmptyState compact title={tr("لا توجد بيانات", "No data")} description={tr("لا توجد سجلات مطابقة في الوقت الحالي.", "No matching records are available right now.")} />}</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}

export function SidePanel({ open, onOpenChange, title, description, children, side = "left", className }) {
  const { direction } = useBilingualPreferences();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side || (direction === "rtl" ? "left" : "right")} className={cn("w-full overflow-y-auto sm:max-w-xl", className)} dir={direction}>
        <SheetHeader className="text-start"><SheetTitle>{title}</SheetTitle>{description && <SheetDescription>{description}</SheetDescription>}</SheetHeader>
        <div className="mt-5">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export function ConfirmationDialog({ open, onOpenChange, title, description, confirmLabel = "تأكيد", cancelLabel = "إلغاء", destructive = false, onConfirm, children }) {
  const { direction } = useBilingualPreferences();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent dir={direction}><AlertDialogHeader><AlertDialogTitle className="text-start">{title}</AlertDialogTitle><AlertDialogDescription className="text-start">{description}</AlertDialogDescription></AlertDialogHeader>{children}<AlertDialogFooter className="gap-2"><AlertDialogCancel>{cancelLabel}</AlertDialogCancel><AlertDialogAction onClick={onConfirm} className={destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}>{confirmLabel}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  );
}

export function SupplierCard({ title, subtitle, badges, actions, children, footer, className, testId }) {
  return (
    <article className={cn("flex min-w-0 flex-col border bg-card", className)} data-testid={testId}>
      <header className="border-b px-4 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-bold text-foreground">{title}</h3>{subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}</div>{actions}</div>{badges && <div className="mt-2 flex flex-wrap gap-1.5">{badges}</div>}</header>
      <div className="flex-1">{children}</div>
      {footer && <footer className="border-t p-3">{footer}</footer>}
    </article>
  );
}

export function MoneyDisplay({ value, currency = "ج.م", className }) {
  const { locale, tr } = useBilingualPreferences();
  const amount = Number(value || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const currencyLabel = currency === "ج.م" ? tr("ج.م", "EGP") : currency;
  return <span className={cn("inline-flex whitespace-nowrap font-mono tabular-nums", className)} dir="ltr">{amount} {currencyLabel}</span>;
}

export function WorkflowStepper({ stages, steps, currentIndex, currentStep, className }) {
  const { tr, direction } = useBilingualPreferences();
  const workflowStages = stages || steps || [];
  if (!workflowStages.length) return null;
  const requestedIndex = currentIndex ?? currentStep ?? 0;
  const safeIndex = Math.max(0, Math.min(Number(requestedIndex) || 0, workflowStages.length - 1));
  const previous = safeIndex > 0 ? workflowStages[safeIndex - 1] : null;
  const next = safeIndex < workflowStages.length - 1 ? workflowStages[safeIndex + 1] : null;
  return (
    <div className={cn("border bg-card p-3", className)}>
      <div className="flex items-center justify-between gap-3 text-xs"><div><span className="text-muted-foreground">{tr("المرحلة الحالية", "Current stage")}</span><div className="mt-0.5 font-bold text-primary">{workflowStages[safeIndex]}</div></div><span className="font-mono text-muted-foreground" dir="ltr">{safeIndex + 1}/{workflowStages.length}</span></div>
      <div className="mt-3 h-1 overflow-hidden bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${((safeIndex + 1) / workflowStages.length) * 100}%` }} /></div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground"><span>{previous ? <>{direction === "rtl" ? <ArrowRight className="me-1 inline h-3 w-3" /> : <ArrowLeft className="me-1 inline h-3 w-3" />}{previous}</> : tr("بداية المسار", "Workflow start")}</span><span className="text-end">{next ? <>{next}{direction === "rtl" ? <ArrowLeft className="ms-1 inline h-3 w-3" /> : <ArrowRight className="ms-1 inline h-3 w-3" />}</> : tr("اكتمل المسار", "Workflow complete")}</span></div>
    </div>
  );
}

export function AttachmentBlock({ title = "المرفقات", attachments = [], onView, onUpload, accept = ".pdf,.xls,.xlsx,.jpg,.jpeg,.png,.webp", canUpload = false, helper }) {
  const { tr } = useBilingualPreferences();
  return (
    <div className="border bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs font-bold text-foreground"><Paperclip className="h-4 w-4" />{title}</div>{canUpload && <label className="cursor-pointer border bg-card px-2 py-1 text-[11px] font-semibold text-primary hover:bg-muted">{tr("رفع / استبدال", "Upload / replace")}<input type="file" className="sr-only" accept={accept} multiple onChange={(event) => onUpload?.(Array.from(event.target.files || []))} /></label>}</div>
      {helper && <p className="mt-1 text-[11px] text-muted-foreground">{helper}</p>}
      <div className="mt-2 space-y-1.5">{attachments.map((file) => <button key={file.id || file.original_filename} type="button" onClick={() => onView?.(file)} className="flex w-full items-center justify-between gap-2 border bg-card px-2.5 py-2 text-start text-xs hover:border-primary/40"><span className="min-w-0 truncate"><FileText className="me-1.5 inline h-3.5 w-3.5 text-muted-foreground" />{file.original_filename || file.name}</span><span className="text-primary">{tr("عرض", "View")}</span></button>)}{!attachments.length && <div className="border border-dashed bg-card p-3 text-center text-[11px] text-muted-foreground">{tr("لا يوجد مرفق لعرض المورد.", "No supplier quotation attachment.")}</div>}</div>
    </div>
  );
}

export function ActionMenu({ actions, label = "إجراءات", testId }) {
  const { direction } = useBilingualPreferences();
  return (
    <DropdownMenu dir={direction}><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label={label} data-testid={testId}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{actions.filter(Boolean).map((action) => <DropdownMenuItem key={action.label} disabled={action.disabled} onSelect={action.onSelect} className={action.destructive ? "text-destructive focus:text-destructive" : undefined} data-testid={action.testId}>{action.icon}{action.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
  );
}

export function ActionBar({ children, className, sticky = false }) {
  return <div className={cn("flex flex-wrap items-center gap-2 border bg-card p-2.5", sticky && "sticky bottom-3 z-20 shadow-sm", className)}>{children}</div>;
}

export const CompactTable = DataTable;
export const SupplierOfferCard = SupplierCard;
export const WorkflowStatus = WorkflowStepper;

export function Timeline({ events = [], renderEvent, emptyLabel, className }) {
  const { tr, locale } = useBilingualPreferences();
  if (!events.length) return <EmptyState compact title={emptyLabel || tr("لا يوجد سجل نشاط", "No activity history")} />;
  return <div className={cn("space-y-3", className)}>{events.map((event, index) => <div key={event.id || index} className="border-s-2 border-primary/25 ps-3 text-sm"><div>{renderEvent ? renderEvent(event) : event.message}</div>{event.created_at && <div className="mt-0.5 text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString(locale)}</div>}</div>)}</div>;
}
