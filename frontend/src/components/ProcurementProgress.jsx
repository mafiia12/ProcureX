import { WorkflowStepper } from "@/components/procurement-ui";

const STAGES = [
  "طلب الموقع",
  "مراجعة فنية",
  "مقارنة أسعار",
  "اعتماد المقارنة",
  "اعتماد الصرف",
  "إتاحة المبلغ",
  "أمر شراء",
  "قيد التوريد",
  "الاستلام",
  "مكتمل",
];

export default function ProcurementProgress({ currentStage = 0, className = "" }) {
  return <WorkflowStepper steps={STAGES} currentStep={currentStage} className={className} />;
}

export { STAGES as PROCUREMENT_STAGES };
