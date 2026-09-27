import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Scale } from "lucide-react";
import { toast } from "sonner";

import {
  DataTable, EmptyState, FilterBar, PageHeader, SearchInput, StatusBadge,
} from "@/components/procurement-ui";
import { Button } from "@/components/ui/button";
import api, { errMsg } from "@/lib/api";
import { usePreferences } from "@/contexts/PreferencesContext";
import { cn } from "@/lib/utils";

// Status is derived, never a stored column - mirrors the exact bucketing
// _dashboard_procurement_intelligence already uses for RFQ attention
// (rfq.list_rfqs computes it the same way server-side; these are display
// labels only, not a second status system).
const STATUS_LABEL = {
  past_deadline: ["متأخر", "Past deadline"],
  no_suppliers: ["بدون موردين", "No suppliers"],
  zero_response: ["بانتظار العروض", "Awaiting quotations"],
  partial_response: ["استلام جزئي", "Partially received"],
  all_received: ["اكتملت العروض", "All quotations received"],
  closed: ["مغلق", "Closed"],
};
const STATUS_TONE = {
  past_deadline: "danger", no_suppliers: "neutral", zero_response: "warning",
  partial_response: "warning", all_received: "success", closed: "neutral",
};

const KPI_DEFS = [
  { key: "open", label: ["طلبات تسعير مفتوحة", "Open RFQs"], test: (row) => row.is_open },
  { key: "awaiting", label: ["بانتظار عروض", "Awaiting quotations"], test: (row) => row.is_open && row.received_quotation_count < row.supplier_count },
  { key: "past_deadline", label: ["متأخرة عن الموعد", "Past deadline"], test: (row) => row.is_past_deadline },
  { key: "ready", label: ["جاهزة للمقارنة", "Ready for comparison"], test: (row) => row.ready_for_comparison && !row.comparison_id },
];

export default function RfqRegister() {
  const navigate = useNavigate();
  const { tr, locale } = usePreferences();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [kpiFilter, setKpiFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/workflow/rfqs");
      setRows(data || []);
    } catch (error) { toast.error(errMsg(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const projects = useMemo(() => [...new Set(rows.map((row) => row.project_name).filter(Boolean))].sort(), [rows]);
  const suppliers = useMemo(
    () => [...new Set(rows.flatMap((row) => row.supplier_names || []))].sort(),
    [rows],
  );

  const kpiCounts = useMemo(() => Object.fromEntries(
    KPI_DEFS.map((kpi) => [kpi.key, rows.filter(kpi.test).length]),
  ), [rows]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ar");
    const activeKpi = KPI_DEFS.find((kpi) => kpi.key === kpiFilter);
    return rows.filter((row) => (
      (!activeKpi || activeKpi.test(row))
      && (!projectFilter || row.project_name === projectFilter)
      && (!statusFilter || row.status === statusFilter)
      && (!supplierFilter || (row.supplier_names || []).includes(supplierFilter))
      && (!query || [row.rfq_number, row.project_name, row.source_request_number]
        .some((value) => String(value || "").toLocaleLowerCase("ar").includes(query)))
    ));
  }, [rows, search, projectFilter, statusFilter, supplierFilter, kpiFilter]);

  const clearFilters = () => {
    setSearch(""); setProjectFilter(""); setStatusFilter(""); setSupplierFilter(""); setKpiFilter("");
  };
  const toggleKpi = (key) => setKpiFilter((current) => (current === key ? "" : key));

  const openRfq = (row) => navigate(`/rfq/${row.id}`);
  const openSourceRequest = (row) => navigate("/incoming-requests", { state: { request_id: row.source_request_id } });
  const openComparison = (row) => navigate("/supplier-price-comparison", { state: { comparison_id: row.comparison_id } });

  const columns = [
    { key: "rfq_number", label: tr("رقم RFQ", "RFQ number"), render: (row) => <span className="font-mono font-bold text-primary" dir="ltr">{row.rfq_number}</span> },
    { key: "project_name", label: tr("المشروع", "Project"), className: "max-w-40 truncate" },
    {
      key: "source_request_number", label: tr("الطلب المصدر", "Source REQ"),
      render: (row) => row.source_request_number ? (
        <button
          type="button"
          className="font-mono text-primary hover:underline"
          dir="ltr"
          data-testid={`rfq-source-req-${row.id}`}
          onClick={(event) => { event.stopPropagation(); openSourceRequest(row); }}
        >
          {row.source_request_number}
        </button>
      ) : "-",
    },
    { key: "item_count", label: tr("الأصناف", "Items"), className: "text-end tabular-nums w-16" },
    {
      key: "supplier_count", label: tr("الموردون المدعوون", "Invited suppliers"),
      className: "text-end tabular-nums w-20",
      render: (row) => <span title={(row.supplier_names || []).join(", ")}>{row.supplier_count}</span>,
    },
    {
      key: "received_quotation_count", label: tr("عروض مستلمة", "Quotations received"),
      render: (row) => (
        <span className="font-semibold tabular-nums" dir="ltr" data-testid={`rfq-quotation-progress-${row.id}`}>
          {row.received_quotation_count} / {row.supplier_count}
        </span>
      ),
    },
    {
      key: "deadline", label: tr("الموعد النهائي", "Deadline"),
      render: (row) => row.deadline ? (
        <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", row.is_past_deadline && "font-bold text-destructive")} dir="ltr">
          {row.is_past_deadline && <AlertTriangle className="h-3 w-3 shrink-0" data-testid={`rfq-overdue-${row.id}`} />}
          {row.deadline}
        </span>
      ) : "-",
    },
    {
      key: "status", label: tr("الحالة", "Status"),
      render: (row) => <StatusBadge tone={STATUS_TONE[row.status] || "neutral"}>{tr(...(STATUS_LABEL[row.status] || [row.status, row.status]))}</StatusBadge>,
    },
    {
      key: "updated_at", label: tr("آخر نشاط", "Last activity"), className: "whitespace-nowrap",
      render: (row) => row.updated_at ? new Date(row.updated_at).toLocaleDateString(locale) : "-",
    },
    {
      key: "actions", label: "", className: "w-40",
      render: (row) => {
        if (row.comparison_id) {
          return (
            <Button
              type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs"
              data-testid={`rfq-open-comparison-${row.id}`}
              onClick={(event) => { event.stopPropagation(); openComparison(row); }}
            >
              <Scale className="h-3.5 w-3.5" />{tr("فتح المقارنة", "Open comparison")}
            </Button>
          );
        }
        if (row.ready_for_comparison) {
          return (
            <Button
              type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs"
              data-testid={`rfq-create-comparison-${row.id}`}
              onClick={(event) => { event.stopPropagation(); openRfq(row); }}
            >
              <Scale className="h-3.5 w-3.5" />{tr("إنشاء المقارنة", "Create comparison")}
            </Button>
          );
        }
        return null;
      },
    },
  ];

  return (
    <div className="space-y-3" data-testid="rfq-register-page">
      <PageHeader
        title={tr("طلبات عروض الأسعار (RFQ)", "Requests for Quotation (RFQ)")}
        description={tr("سجل تشغيلي مختصر لطلبات التسعير؛ التفاصيل الكاملة داخل مساحة عمل كل RFQ.", "A concise operational register for RFQs; full detail lives inside each RFQ's own workspace.")}
        actions={<Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("/incoming-requests")} data-testid="rfq-create-from-request">
          <ArrowRight className="h-4 w-4" />{tr("إنشاء RFQ من طلب", "Create RFQ from a request")}
        </Button>}
      />

      <div className="grid grid-cols-2 border bg-card sm:grid-cols-4" data-testid="rfq-kpi-strip">
        {KPI_DEFS.map((kpi, index) => (
          <button
            key={kpi.key}
            type="button"
            onClick={() => toggleKpi(kpi.key)}
            className={cn(
              "min-w-0 border-border px-3 py-2 text-start transition-colors hover:bg-muted/50",
              index > 0 && "border-s",
              kpiFilter === kpi.key && "bg-primary/10",
            )}
            data-testid={`rfq-kpi-${kpi.key}`}
            aria-pressed={kpiFilter === kpi.key}
          >
            <div className="truncate text-[11px] text-muted-foreground">{tr(...kpi.label)}</div>
            <div className="mt-0.5 text-lg font-extrabold tabular-nums text-foreground">{kpiCounts[kpi.key]}</div>
          </button>
        ))}
      </div>

      <FilterBar
        resultLabel={tr(`${filteredRows.length} من ${rows.length} طلب تسعير`, `${filteredRows.length} of ${rows.length} RFQs`)}
        onClear={clearFilters}
      >
        <SearchInput className="w-full sm:w-72" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tr("رقم RFQ أو المشروع أو الطلب المصدر...", "RFQ number, project, or source REQ...")} data-testid="rfq-search" />
        <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="h-8 rounded-md border bg-background px-2.5 text-sm" data-testid="rfq-project-filter">
          <option value="">{tr("كل المشاريع", "All projects")}</option>
          {projects.map((value) => <option key={value}>{value}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-8 rounded-md border bg-background px-2.5 text-sm" data-testid="rfq-status-filter">
          <option value="">{tr("كل الحالات", "All statuses")}</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{tr(...label)}</option>)}
        </select>
        <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} className="h-8 rounded-md border bg-background px-2.5 text-sm" data-testid="rfq-supplier-filter">
          <option value="">{tr("كل الموردين", "All suppliers")}</option>
          {suppliers.map((value) => <option key={value}>{value}</option>)}
        </select>
      </FilterBar>

      {loading ? (
        <div className="border bg-card p-8 text-center text-sm text-muted-foreground">{tr("جارٍ تحميل طلبات التسعير...", "Loading RFQs...")}</div>
      ) : (
        <DataTable
          columns={columns}
          rows={filteredRows}
          rowTestId="rfq-row"
          tableClassName="min-w-[980px]"
          onRowClick={openRfq}
          empty={<EmptyState title={tr("لا توجد طلبات تسعير", "No RFQs")} description={tr("يبدأ طلب التسعير من طلب شراء وارد جاهز للتسعير.", "An RFQ starts from an incoming request that's ready for pricing.")} />}
        />
      )}
    </div>
  );
}
