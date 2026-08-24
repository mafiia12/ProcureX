// Database values remain stable for historical compatibility. These names are
// the authoritative business meanings used by the UI.
export const APPROVAL_STAGES = Object.freeze({
  COMPARISON_TECHNICAL: "comparison_technical",
  EXPENDITURE_APPROVAL: "fund_release",
  FUNDS_AVAILABILITY: "funds_release",
  PO_READY: "po_ready",
  EXTERNAL_REVIEW: "external_review",
});

export const APPROVAL_STAGE_LABELS = Object.freeze({
  [APPROVAL_STAGES.COMPARISON_TECHNICAL]: "اعتماد مقارنة الأسعار",
  [APPROVAL_STAGES.EXPENDITURE_APPROVAL]: "الموافقة التجارية / اعتماد الصرف",
  [APPROVAL_STAGES.FUNDS_AVAILABILITY]: "تأكيد إتاحة / تسليم المبلغ",
  [APPROVAL_STAGES.PO_READY]: "جاهز لإصدار أمر الشراء",
  [APPROVAL_STAGES.EXTERNAL_REVIEW]: "مراجعة خارجية قديمة",
});

export const approvalProgressStage = (stage) => {
  if (stage === APPROVAL_STAGES.PO_READY) return 6;
  if (stage === APPROVAL_STAGES.FUNDS_AVAILABILITY) return 5;
  if (stage === APPROVAL_STAGES.EXPENDITURE_APPROVAL) return 4;
  return 3;
};
