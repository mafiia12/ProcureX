import CrudPage from "@/components/CrudPage";

export default function Customers() {
  return (
    <CrudPage
      title="عميل"
      endpoint="customers"
      testPrefix="customers"
      columns={[
        { key: "code", label: "الكود" },
        { key: "name", label: "اسم العميل" },
        { key: "contact_person", label: "مسؤول التواصل" },
        { key: "phone", label: "الهاتف" },
        { key: "email", label: "البريد الإلكتروني" },
        { key: "governorate", label: "المحافظة" },
        { key: "city", label: "المدينة" },
        { key: "status", label: "الحالة" },
      ]}
      fields={[
        { key: "name", label: "اسم العميل", required: true },
        { key: "contact_person", label: "مسؤول التواصل" },
        { key: "phone", label: "رقم الهاتف" },
        { key: "whatsapp", label: "واتساب" },
        { key: "email", label: "البريد الإلكتروني" },
        { key: "governorate", label: "المحافظة" },
        { key: "city", label: "المدينة" },
        { key: "address", label: "العنوان" },
        { key: "status", label: "الحالة" },
        { key: "notes", label: "ملاحظات", type: "textarea" },
      ]}
    />
  );
}
