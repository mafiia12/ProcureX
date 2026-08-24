import { canTransitionApproval, cashCanBeConfirmed, paymentIsPaid, proofValidationMessage } from "./approvalWorkflow";

test("approval transitions reject invalid terminal changes", () => {
  expect(canTransitionApproval("draft", "ready_to_send")).toBe(true);
  expect(canTransitionApproval("approved", "rejected")).toBe(false);
});

test("proof validation accepts only supported images up to five MB", () => {
  expect(proofValidationMessage({ type: "image/png", size: 1024 })).toBe("");
  expect(proofValidationMessage({ type: "application/pdf", size: 1024 })).toContain("JPG");
  expect(proofValidationMessage({ type: "image/jpeg", size: 6 * 1024 * 1024 })).toContain("5");
});

test("payment and one-time cash states are explicit", () => {
  expect(paymentIsPaid({ status: "under_review" })).toBe(false);
  expect(paymentIsPaid({ status: "verified" })).toBe(true);
  expect(cashCanBeConfirmed({ method: "cash", status: "pending", cash_consumed_at: "" })).toBe(true);
  expect(cashCanBeConfirmed({ method: "cash", status: "verified", cash_consumed_at: "now" })).toBe(false);
});

