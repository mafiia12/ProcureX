export const buildApprovalUrl = (secureToken, origin = window.location.origin) =>
  `${String(origin).replace(/\/+$/, "")}/approval/${encodeURIComponent(secureToken)}`;

export const buildApprovalMessage = (approval, url) => [
  "RE DECOR & MORE",
  `يرجى مراجعة الاعتماد ${approval.approval_number}`,
  approval.project_name ? `المشروع: ${approval.project_name}` : "",
  approval.comparison_number ? `المقارنة: ${approval.comparison_number}` : "",
  `الإجمالي: ${Number(approval.final_total || 0).toLocaleString("ar-EG")} جنيه`,
  `رابط المراجعة الآمن: ${url}`,
].filter(Boolean).join("\n");

export const buildWhatsAppUrl = (approval, url) => {
  const phone = String(approval.engineer_phone || "").replace(/\D/g, "");
  return `https://wa.me/${phone}?text=${encodeURIComponent(buildApprovalMessage(approval, url))}`;
};

export const buildEmailUrl = (approval, url) => {
  const subject = `اعتماد ${approval.approval_number} - ${approval.project_name || "RE DECOR & MORE"}`;
  return `mailto:${encodeURIComponent(approval.engineer_email || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildApprovalMessage(approval, url))}`;
};

