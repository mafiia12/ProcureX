export const approvalTransitions = {
  draft: ["ready_to_send", "cancelled"],
  ready_to_send: ["sent", "cancelled"],
  sent: ["pending_approval", "approved", "rejected", "revision_requested", "cancelled"],
  pending_approval: ["approved", "rejected", "revision_requested", "cancelled"],
  approved: [], rejected: [], revision_requested: [], expired: [], cancelled: [],
};

export const canTransitionApproval = (from, to) =>
  (approvalTransitions[from] || []).includes(to);

export const proofValidationMessage = (file) => {
  if (!file) return "اختر صورة إثبات الدفع";
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return "ارفع صورة JPG أو PNG أو WebP فقط";
  }
  if (file.size > 5 * 1024 * 1024) return "حجم الصورة يجب ألا يتجاوز 5 ميجابايت";
  return "";
};

export const paymentIsPaid = (payment) => payment?.status === "verified";
export const cashCanBeConfirmed = (payment) =>
  payment?.method === "cash" && payment?.status === "pending" && !payment?.cash_consumed_at;

