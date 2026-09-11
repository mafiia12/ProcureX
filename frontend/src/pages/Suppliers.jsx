import { useState } from "react";
import { toast } from "sonner";
import CrudPage from "@/components/CrudPage";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/procurement-ui";
import api, { errMsg, fmtEGP } from "@/lib/api";
import { useNavigate } from "react-router-dom";
import { usePreferences } from "@/contexts/PreferencesContext";
import { Pencil, History, Power, MessageCircle } from "lucide-react";

const ACTIVE_STATUS = "نشط";
const INACTIVE_STATUS = "غير نشط";

function DetailRow({ label, value, dir, href }) {
  const content = (
    <span className="mt-0.5 block truncate text-sm font-medium text-foreground" dir={dir} title={typeof value === "string" ? value : undefined}>
      {value || "-"}
    </span>
  );
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{href && value ? <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">{content}</a> : content}</dd>
    </div>
  );
}

function SupplierDrawer({ supplier, tr, onEdit, onViewHistory, onReload }) {
  const [toggling, setToggling] = useState(false);
  const isActive = supplier.status !== INACTIVE_STATUS;

  const toggleStatus = async () => {
    setToggling(true);
    try {
      await api.put(`/suppliers/${supplier.id}`, { status: isActive ? INACTIVE_STATUS : ACTIVE_STATUS });
      toast.success(tr("تم تحديث حالة المورد", "Supplier status updated"));
      onReload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="mt-1 space-y-4">
      <div>
        <div className="text-lg font-bold text-foreground">{supplier.name}</div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground" dir="ltr">{supplier.code}</span>
          <StatusBadge tone={isActive ? "success" : "neutral"}>{supplier.status || (isActive ? ACTIVE_STATUS : INACTIVE_STATUS)}</StatusBadge>
        </div>
      </div>

      <section>
        <h3 className="mb-2 text-xs font-bold text-muted-foreground">{tr("التواصل", "Contact")}</h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          <DetailRow label={tr("الهاتف", "Phone")} value={supplier.phone} dir="ltr" />
          <DetailRow
            label={tr("واتساب", "WhatsApp")}
            value={supplier.whatsapp}
            dir="ltr"
            href={supplier.whatsapp ? `https://wa.me/${String(supplier.whatsapp).replace(/\D/g, "")}` : undefined}
          />
          <DetailRow label={tr("مسؤول التواصل", "Contact person")} value={supplier.contact_person} />
          <DetailRow label={tr("البريد الإلكتروني", "Email")} value={supplier.email} dir="ltr" />
          <DetailRow label={tr("المدينة", "City")} value={supplier.city} />
          <DetailRow label={tr("العنوان", "Address")} value={supplier.address} />
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold text-muted-foreground">{tr("بيانات العمل", "Business")}</h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          <DetailRow label={tr("التخصص", "Specialty")} value={supplier.specialty} />
          <DetailRow label={tr("المجموعة", "Group")} value={supplier.group_name} />
          <DetailRow label={tr("شروط الدفع", "Payment terms")} value={supplier.payment_terms} />
          <DetailRow label={tr("مدة التوريد", "Lead time")} value={supplier.lead_time_days ? tr(`${supplier.lead_time_days} يوم`, `${supplier.lead_time_days} days`) : ""} />
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold text-muted-foreground">{tr("مرجع المشتريات", "Procurement reference")}</h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          <DetailRow label={tr("آخر أمر شراء رسمي", "Last purchase order")} value={supplier.last_formal_po_date} />
          <DetailRow label={tr("عدد أوامر الشراء الرسمية", "Formal PO count")} value={supplier.formal_po_count ?? 0} />
          <DetailRow label={tr("قيمة أوامر الشراء الرسمية", "Formal PO value")} value={supplier.formal_po_total != null ? fmtEGP(supplier.formal_po_total) : "-"} />
        </dl>
      </section>

      <div className="flex flex-wrap gap-2 border-t pt-3">
        <Button size="sm" onClick={onEdit} className="gap-1.5"><Pencil className="h-3.5 w-3.5" /> {tr("تعديل", "Edit")}</Button>
        <Button size="sm" variant="outline" onClick={toggleStatus} disabled={toggling} className="gap-1.5">
          <Power className="h-3.5 w-3.5" /> {isActive ? tr("تعطيل", "Deactivate") : tr("تفعيل", "Activate")}
        </Button>
        <Button size="sm" variant="outline" onClick={onViewHistory} className="gap-1.5"><History className="h-3.5 w-3.5" /> {tr("تاريخ الأسعار", "Price history")}</Button>
        {supplier.whatsapp && (
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <a href={`https://wa.me/${String(supplier.whatsapp).replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
              <MessageCircle className="h-3.5 w-3.5" /> {tr("واتساب", "WhatsApp")}
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

export default function Suppliers() {
  const navigate = useNavigate();
  const { tr } = usePreferences();
  const goToHistory = (supplier) => navigate("/price-history", { state: { supplier: supplier.name } });

  return (
    <CrudPage
      title={tr("مورد", "supplier")}
      heading={tr("الموردون", "Suppliers")}
      description={tr("دليل الموردين للبحث السريع والتواصل.", "Supplier directory for quick lookup and contact.")}
      searchPlaceholder={tr("ابحث بالكود أو اسم المورد أو الهاتف...", "Search by code, supplier name, or phone...")}
      emptyTitle={tr("لا يوجد موردون", "No suppliers")}
      emptyDescription={tr("ابدأ بإضافة أول مورد.", "Start by adding your first supplier.")}
      compactManagement
      paginated
      endpoint="suppliers"
      listParams={{ include_procurement: true }}
      testPrefix="suppliers"
      columns={[
        { key: "code", label: tr("كود المورد", "Supplier Code"), ltr: true, className: "font-mono text-xs" },
        { key: "name", label: tr("اسم المورد", "Supplier Name"), truncate: true },
        { key: "specialty", label: tr("التخصص", "Specialty"), hideOnMobile: true, truncate: true },
        { key: "phone", label: tr("الهاتف", "Phone"), ltr: true },
        { key: "city", label: tr("المدينة", "City"), hideOnMobile: true },
        { key: "status", label: tr("الحالة", "Status"), render: (r) => <StatusBadge tone={r.status === INACTIVE_STATUS ? "neutral" : "success"}>{r.status || ACTIVE_STATUS}</StatusBadge> },
      ]}
      filters={[
        { key: "specialty", label: tr("التخصص", "Specialty"), allLabel: tr("كل التخصصات", "All specialties") },
        { key: "status", label: tr("الحالة", "Status"), allLabel: tr("كل الحالات", "All statuses"), options: [{ value: ACTIVE_STATUS, label: tr("نشط", "Active") }, { value: INACTIVE_STATUS, label: tr("غير نشط", "Inactive") }] },
      ]}
      rowAction={{ label: tr("تاريخ الأسعار", "Price History"), onClick: goToHistory }}
      renderDrawer={(supplier, { tr: t, edit, reload }) => (
        <SupplierDrawer supplier={supplier} tr={t} onEdit={() => edit(supplier)} onViewHistory={() => goToHistory(supplier)} onReload={reload} />
      )}
      fields={[
        { key: "name", label: "اسم المورد", labelEn: "Supplier Name", required: true },
        { key: "specialty", label: "التخصص", labelEn: "Specialty" },
        { key: "phone", label: "رقم الهاتف", labelEn: "Phone" },
        { key: "city", label: "المدينة", labelEn: "City" },
        { key: "status", label: "الحالة", labelEn: "Status", type: "select", options: ["نشط", "غير نشط"], default: "نشط" },
      ]}
      advancedFields={[
        { key: "group_name", label: "المجموعة", labelEn: "Group" },
        { key: "governorate", label: "المحافظة", labelEn: "Governorate" },
        { key: "address", label: "العنوان", labelEn: "Address" },
        { key: "contact_person", label: "مسؤول التواصل", labelEn: "Contact Person" },
        { key: "whatsapp", label: "واتساب", labelEn: "WhatsApp" },
        { key: "email", label: "البريد الإلكتروني", labelEn: "Email" },
        { key: "payment_terms", label: "شروط الدفع", labelEn: "Payment Terms" },
        { key: "lead_time_days", label: "مدة التوريد بالأيام", labelEn: "Lead Time (days)" },
        { key: "notes", label: "ملاحظات", labelEn: "Notes", type: "textarea" },
      ]}
    />
  );
}
