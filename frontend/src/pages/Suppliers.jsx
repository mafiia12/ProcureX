import CrudPage from "@/components/CrudPage";
import { fmtEGP } from "@/lib/api";
import { useNavigate } from "react-router-dom";
import { usePreferences } from "@/contexts/PreferencesContext";

export default function Suppliers() {
  const navigate = useNavigate();
  const { tr } = usePreferences();
  return (
    <CrudPage
      title={tr("مورد", "supplier")}
      heading={tr("الموردون", "Suppliers")}
      description={tr("قائمة عملية مختصرة؛ بيانات التواصل والتصنيف وسجل الأسعار متاحة عند فتح السجل.", "A concise operational list. Open a supplier for contacts, classification, and price history.")}
      searchPlaceholder={tr("بحث بالكود أو اسم المورد أو التخصص...", "Search code, supplier, or specialization...")}
      emptyTitle={tr("لا يوجد موردون حتى الآن", "No suppliers yet")}
      emptyDescription={tr("أضف الموردين الذين ستطلب منهم عروض الأسعار؛ ستتراكم سجلات الأسعار وأوامر الشراء تلقائيًا.", "Add suppliers you will invite to quote; quotation and PO history will build automatically.")}
      endpoint="suppliers"
      listParams={{ include_procurement: true }}
      testPrefix="suppliers"
      columns={[
        { key: "code", label: tr("كود المورد", "Supplier Code") },
        { key: "name", label: tr("اسم المورد", "Supplier Name") },
        { key: "specialty", label: tr("التخصص", "Specialization") },
        { key: "group_name", label: tr("المجموعة", "Group") },
        { key: "phone", label: tr("الهاتف", "Phone") },
        { key: "city", label: tr("المدينة", "City") },
        { key: "last_procurement_date", label: tr("آخر نشاط", "Last Activity") },
        { key: "formal_po_total", label: tr("قيمة PO الرسمية", "Formal PO Value"), render: (row) => fmtEGP(row.formal_po_total) },
        { key: "status", label: tr("الحالة", "Status") },
      ]}
      rowAction={{ label: tr("تاريخ الأسعار", "Price History"), onClick: (supplier) => navigate("/price-history", { state: { supplier: supplier.name } }) }}
      fields={[
        { key: "name", label: "اسم المورد", labelEn: "Supplier Name", required: true },
        { key: "specialty", label: "التخصص", labelEn: "Specialization" },
        { key: "group_name", label: "المجموعة", labelEn: "Group" },
        { key: "governorate", label: "المحافظة", labelEn: "Governorate" },
        { key: "city", label: "المدينة", labelEn: "City" },
        { key: "address", label: "العنوان", labelEn: "Address" },
        { key: "contact_person", label: "مسؤول التواصل", labelEn: "Contact Person" },
        { key: "phone", label: "رقم الهاتف", labelEn: "Phone" },
        { key: "whatsapp", label: "واتساب", labelEn: "WhatsApp" },
        { key: "email", label: "البريد الإلكتروني", labelEn: "Email" },
        { key: "payment_terms", label: "شروط الدفع", labelEn: "Payment Terms" },
        { key: "lead_time_days", label: "مدة التوريد بالأيام", labelEn: "Lead Time (days)" },
        { key: "status", label: "الحالة", labelEn: "Status", type: "select", options: ["نشط", "غير نشط"], default: "نشط" },
        { key: "notes", label: "ملاحظات", labelEn: "Notes", type: "textarea" },
      ]}
    />
  );
}
