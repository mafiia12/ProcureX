import { useNavigate } from "react-router-dom";
import CrudPage from "@/components/CrudPage";
import { fmtEGP } from "@/lib/api";
import { usePreferences } from "@/contexts/PreferencesContext";

export default function Projects() {
  const navigate = useNavigate();
  const { tr } = usePreferences();

  return (
    <CrudPage
      title={tr("مشروع", "project")}
      heading={tr("المشروعات", "Projects")}
      description={tr("ملخص مالي وتشغيلي للمشتريات الرسمية لكل مشروع. البيانات الاختيارية تبقى داخل نموذج المشروع.", "A financial and operational summary of formal procurement by project. Optional fields remain in project details.")}
      searchPlaceholder={tr("بحث بكود المشروع أو الاسم أو العميل...", "Search project code, name, or client...")}
      emptyTitle={tr("لا توجد مشروعات حتى الآن", "No projects yet")}
      emptyDescription={tr("أنشئ المشروع أولًا لربط طلبات الشراء وأوامر الشراء والدفعات به.", "Create a project to link purchase requests, purchase orders, and payments.")}
      endpoint="projects"
      listParams={{ include_procurement: true }}
      testPrefix="projects"
      rowAction={{
  label: tr("تفاصيل المشتريات", "Procurement Details"),
  onClick: (project) =>
    navigate(`/projects/${project.id}/purchases`),
}}
      columns={[
        { key: "code", label: tr("الكود", "Project Code") },
        { key: "name", label: tr("اسم المشروع", "Project Name") },
        { key: "customer_name", label: tr("العميل", "Client") },
        { key: "city", label: tr("المدينة", "City") },
        { key: "engineer", label: tr("المهندس المسؤول", "Responsible Engineer") },
        { key: "active_request_count", label: tr("REQ نشطة", "Active REQs") },
        { key: "active_po_count", label: tr("PO نشطة", "Active POs") },
        { key: "formal_po_value", label: tr("قيمة PO", "PO Value"), render: (row) => fmtEGP(row.formal_po_value) },
        { key: "paid_amount", label: tr("المدفوع", "Paid"), render: (row) => fmtEGP(row.paid_amount) },
        { key: "outstanding_amount", label: tr("المتبقي", "Outstanding"), render: (row) => fmtEGP(row.outstanding_amount) },
        { key: "status", label: tr("الحالة", "Status") },
      ]}
      fields={[
        { key: "name", label: "اسم المشروع", labelEn: "Project Name", required: true },
        { key: "customer_name", label: "العميل", labelEn: "Client" },
        { key: "governorate", label: "المحافظة", labelEn: "Governorate" },
        { key: "city", label: "المدينة", labelEn: "City" },
        { key: "address", label: "العنوان", labelEn: "Address" },
        { key: "engineer", label: "المهندس المسؤول", labelEn: "Responsible Engineer" },
        { key: "start_date", label: "تاريخ البدء", labelEn: "Start Date", type: "date" },
        { key: "end_date", label: "تاريخ الانتهاء المتوقع", labelEn: "Expected End Date", type: "date" },
        { key: "budget", label: "الميزانية", labelEn: "Budget" },
        { key: "status", label: "حالة المشروع", labelEn: "Project Status" },
        { key: "notes", label: "ملاحظات", labelEn: "Notes", type: "textarea" },
      ]}
    />
  );
}
