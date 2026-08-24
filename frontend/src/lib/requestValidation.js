export const PRIORITY_OPTIONS = [
  { value: "low", label: "منخفضة" },
  { value: "normal", label: "عادية" },
  { value: "high", label: "عالية" },
  { value: "urgent", label: "عاجلة" },
];

export const emptyRequestedItem = () => ({
  product_name: "",
  preferred_brand: "",
  main_category: "",
  subcategory: "",
  specifications: "",
  quantity: "",
  unit: "",
  attachment: null,
});

export const newSubmissionToken = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export function validatePublicRequest(form, items, today = new Date().toISOString().slice(0, 10)) {
  const required = [
    ["requester_name", "اسم مقدم الطلب مطلوب"],
    ["phone_number", "رقم الهاتف مطلوب"],
    ["project_name", "اسم المشروع مطلوب"],
    ["project_location", "موقع المشروع مطلوب"],
    ["delivery_location", "مكان التسليم مطلوب"],
    ["required_delivery_date", "تاريخ التسليم المطلوب مطلوب"],
    ["priority", "درجة الأولوية مطلوبة"],
  ];
  for (const [key, message] of required) {
    if (!String(form[key] || "").trim()) return message;
  }
  if (!/^[+0-9()\-\s]{7,30}$/.test(form.phone_number)) return "رقم الهاتف غير صحيح";
  if (form.whatsapp_number && !/^[+0-9()\-\s]{7,30}$/.test(form.whatsapp_number)) {
    return "رقم واتساب غير صحيح";
  }
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    return "البريد الإلكتروني غير صحيح";
  }
  if (form.required_delivery_date < today) return "تاريخ التسليم لا يمكن أن يكون في الماضي";
  if (!items.length) return "أضف صنفاً واحداً على الأقل";
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item.product_name.trim()) return `اسم المنتج مطلوب في الصنف ${index + 1}`;
    if (!(Number(item.quantity) > 0)) return `الكمية غير صحيحة في الصنف ${index + 1}`;
    if (!item.unit.trim()) return `الوحدة مطلوبة في الصنف ${index + 1}`;
    if (item.attachment && item.attachment.size > 5 * 1024 * 1024) {
      return `حجم مرفق الصنف ${index + 1} يتجاوز 5 ميجابايت`;
    }
  }
  return null;
}

export function buildPublicRequestFormData(form, items, submissionToken) {
  const files = [];
  const requestItems = items.map(({ attachment, ...item }) => {
    const attachmentIndex = attachment ? files.push(attachment) - 1 : null;
    return {
      ...item,
      quantity: Number(item.quantity),
      attachment_index: attachmentIndex,
    };
  });
  const data = new FormData();
  data.append("payload", JSON.stringify({ ...form, submission_token: submissionToken, items: requestItems }));
  data.append("website", "");
  files.forEach((file) => data.append("attachments", file));
  return data;
}

