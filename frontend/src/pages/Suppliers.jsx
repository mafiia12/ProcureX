import CrudPage from "@/components/CrudPage";
import { fmtEGP } from "@/lib/api";
import { useNavigate } from "react-router-dom";

export default function Suppliers() {
  const navigate = useNavigate();
  return (
    <CrudPage
      title="مورد"
      heading="الموردون"
      description="قائمة عملية مختصرة؛ بيانات التواصل والتصنيف وسجل الأسعار متاحة عند فتح السجل."
      searchPlaceholder="بحث بالكود أو اسم المورد أو التخصص..."
      emptyTitle="لا يوجد موردون حتى الآن"
      emptyDescription="أضف الموردين الذين ستطلب منهم عروض الأسعار؛ ستتراكم سجلات الأسعار وأوامر الشراء تلقائيًا."
      endpoint="suppliers"
      listParams={{ include_procurement: true }}
      testPrefix="suppliers"
      columns={[
        { key: "code", label: "كود المورد" },
        { key: "name", label: "اسم المورد" },
        { key: "specialty", label: "التخصص" },
        { key: "group_name", label: "المجموعة" },
        { key: "phone", label: "الهاتف" },
        { key: "city", label: "المدينة" },
        { key: "last_procurement_date", label: "آخر شراء" },
        { key: "formal_po_total", label: "قيمة PO الرسمية", render: (row) => fmtEGP(row.formal_po_total) },
        { key: "status", label: "الحالة" },
      ]}
      rowAction={{ label: "تاريخ الأسعار", onClick: (supplier) => navigate("/price-history", { state: { supplier: supplier.name } }) }}
      fields={[
        { key: "name", label: "اسم المورد", required: true },
        { key: "specialty", label: "التخصص" },
        { key: "group_name", label: "المجموعة" },
        { key: "governorate", label: "المحافظة" },
        { key: "city", label: "المدينة" },
        { key: "address", label: "العنوان" },
        { key: "contact_person", label: "مسؤول التواصل" },
        { key: "phone", label: "رقم الهاتف" },
        { key: "whatsapp", label: "واتساب" },
        { key: "email", label: "البريد الإلكتروني" },
        { key: "payment_terms", label: "شروط الدفع" },
        { key: "lead_time_days", label: "مدة التوريد بالأيام" },
        { key: "status", label: "الحالة", type: "select", options: ["نشط", "غير نشط"], default: "نشط" },
        { key: "notes", label: "ملاحظات", type: "textarea" },
      ]}
    />
  );
}
