import { useNavigate } from "react-router-dom";
import CrudPage from "@/components/CrudPage";
import { fmtEGP } from "@/lib/api";

export default function Projects() {
  const navigate = useNavigate();

  return (
    <CrudPage
      title="مشروع"
      heading="المشروعات"
      description="ملخص مالي وتشغيلي للمشتريات الرسمية لكل مشروع. البيانات الاختيارية تبقى داخل نموذج المشروع."
      searchPlaceholder="بحث بكود المشروع أو الاسم أو العميل..."
      emptyTitle="لا توجد مشروعات حتى الآن"
      emptyDescription="أنشئ المشروع أولًا لربط طلبات الشراء وأوامر الشراء والدفعات به."
      endpoint="projects"
      listParams={{ include_procurement: true }}
      testPrefix="projects"
      rowAction={{
  label: "تفاصيل المشتريات",
  onClick: (project) =>
    navigate(`/projects/${project.id}/purchases`),
}}
      columns={[
        { key: "code", label: "الكود" },
        { key: "name", label: "اسم المشروع" },
        { key: "customer_name", label: "العميل" },
        { key: "city", label: "المدينة" },
        { key: "engineer", label: "المهندس المسؤول" },
        { key: "active_request_count", label: "REQ نشطة" },
        { key: "active_po_count", label: "PO نشطة" },
        { key: "formal_po_value", label: "قيمة PO", render: (row) => fmtEGP(row.formal_po_value) },
        { key: "paid_amount", label: "المدفوع", render: (row) => fmtEGP(row.paid_amount) },
        { key: "outstanding_amount", label: "المتبقي", render: (row) => fmtEGP(row.outstanding_amount) },
        { key: "status", label: "الحالة" },
      ]}
      fields={[
        { key: "name", label: "اسم المشروع", required: true },
        { key: "customer_name", label: "العميل" },
        { key: "governorate", label: "المحافظة" },
        { key: "city", label: "المدينة" },
        { key: "address", label: "العنوان" },
        { key: "engineer", label: "المهندس المسؤول" },
        { key: "start_date", label: "تاريخ البدء", type: "date" },
        { key: "end_date", label: "تاريخ الانتهاء المتوقع", type: "date" },
        { key: "budget", label: "الميزانية" },
        { key: "status", label: "حالة المشروع" },
        { key: "notes", label: "ملاحظات", type: "textarea" },
      ]}
    />
  );
}
