// Single source of truth for Purchase Order status labels/styles, shared by
// the PO Register and the PO Details workspace so the two pages never show
// conflicting labels for the same backend status.

export const PO_STATUS_LABEL = {
  draft: "مسودة",
  approved: "معتمد",
  sent: "تم الإرسال للمورد",
  supplier_confirmed: "تأكيد المورد",
  in_delivery: "قيد التوريد",
  partial_received: "استلام جزئي",
  delivery_problem: "مشكلة في التوريد",
  completed: "مكتمل",
  cancelled: "ملغي",
};

export const PO_STATUS_STYLE = {
  draft: "bg-slate-100 text-slate-700",
  approved: "bg-emerald-100 text-emerald-700",
  sent: "bg-blue-100 text-blue-700",
  supplier_confirmed: "bg-indigo-100 text-indigo-700",
  in_delivery: "bg-cyan-100 text-cyan-800",
  partial_received: "bg-amber-100 text-amber-800",
  delivery_problem: "bg-red-100 text-red-800",
  completed: "bg-emerald-100 text-emerald-900",
  cancelled: "bg-red-100 text-red-700",
};

// The PO status itself already encodes receiving progress; this only maps
// it to the five actual receiving-lifecycle concepts for a dedicated
// "Receiving Status" filter/column - no new backend field, no payment data
// involved.
export const poReceivingStatus = (status) => {
  if (status === "in_delivery") return "in_delivery";
  if (status === "partial_received") return "partially_received";
  if (status === "delivery_problem") return "delivery_problem";
  if (status === "completed") return "fully_received";
  return "not_started"; // draft, approved, sent, supplier_confirmed, cancelled
};

export const PO_RECEIVING_STATUS_LABEL = {
  not_started: "لم يبدأ الاستلام",
  in_delivery: "قيد التوريد",
  partially_received: "استلام جزئي",
  delivery_problem: "مشكلة في التوريد",
  fully_received: "اكتمل الاستلام",
};

// Derived from the linked approval's workflow flags only (expenditure
// approved / funds released). This is commercial/funds APPROVAL, never an
// actual supplier payment - it must never be labeled "Payment Status" (see
// poActualPaymentStatus below for the real PO Payment Ledger status).
export const poFundsStatus = (workflow) => {
  if (workflow?.funds_released) return "funds_released";
  if (workflow?.expenditure_approved) return "pending_release";
  return "pending_approval";
};

export const PO_FUNDS_STATUS_LABEL = {
  funds_released: "🟢 المبلغ متاح",
  pending_release: "بانتظار إتاحة المبلغ",
  pending_approval: "بانتظار اعتماد الصرف",
};

// The REAL PO Payment Ledger status (backend payment_summary.payment_status
// - actual recorded supplier payments only, never funds-release amounts).
export const PO_ACTUAL_PAYMENT_STATUS_LABEL = {
  not_due: "لم يحن السداد",
  due: "مستحق السداد",
  partially_paid: "مدفوع جزئيًا",
  paid: "مدفوع بالكامل",
};

export const PO_ACTUAL_PAYMENT_STATUS_STYLE = {
  not_due: "bg-slate-100 text-slate-700",
  due: "bg-amber-100 text-amber-800",
  partially_paid: "bg-blue-100 text-blue-800",
  paid: "bg-emerald-100 text-emerald-800",
};

// payment_summary may be absent (e.g. a stale cached row); never crash.
export const poActualPaymentStatusLabel = (summary) => {
  if (!summary) return "غير متاح";
  const base = PO_ACTUAL_PAYMENT_STATUS_LABEL[summary.payment_status] || summary.payment_status;
  return summary.is_overdue ? `${base} · متأخر` : base;
};

// draft -> approved -> sent -> supplier_confirmed, mirroring the backend's
// PATCH /purchase-orders/{id}/status transition matrix exactly (server.py,
// update_purchase_order_status). Not a new state machine - just the next
// step in the existing one, and only used to label the "advance" action.
export const PO_NEXT_STATUS = {
  draft: "approved",
  approved: "sent",
  sent: "supplier_confirmed",
};

export const PO_NEXT_STATUS_ACTION_LABEL = {
  approved: "اعتماد أمر الشراء",
  sent: "تسجيل الإرسال للمورد",
  supplier_confirmed: "تأكيد موافقة المورد",
};

// Statuses from which the existing PATCH endpoint still allows "cancelled".
export const PO_CANCELLABLE_STATUSES = new Set(["draft", "approved", "sent", "supplier_confirmed"]);

export const PO_PAYMENT_METHOD_LABEL = {
  bank_transfer: "تحويل بنكي",
  cash: "نقدي",
  cheque: "شيك",
  card: "بطاقة",
  other: "أخرى",
};
