import { FOLLOW_UP_ROUTE_BUILDERS, KNOWN_FOLLOW_UP_TYPES, getFollowUpTarget } from "@/lib/followUpNavigation";

const KNOWN_TYPES = [
  "delivery_problem", "overdue_payment", "partial_received",
  "awaiting_supplier_confirmation", "rfq_past_deadline", "quotation_missing",
  "sourcing_required", "needs_clarification", "request_review", "pending_approval",
];

test("every known backend action type has an explicit route builder", () => {
  for (const type of KNOWN_TYPES) {
    expect(FOLLOW_UP_ROUTE_BUILDERS[type]).toBeInstanceOf(Function);
  }
  expect(KNOWN_FOLLOW_UP_TYPES.sort()).toEqual([...KNOWN_TYPES].sort());
});

test("REQ technical-review / clarification / sourcing follow-ups open the exact request", () => {
  for (const type of ["request_review", "needs_clarification", "sourcing_required"]) {
    const target = getFollowUpTarget({ type, request_id: "req-1", path: "/incoming-requests" });
    expect(target).toEqual({ pathname: "/incoming-requests", state: { request_id: "req-1" } });
  }
});

test("RFQ follow-ups open the exact RFQ workspace", () => {
  for (const type of ["rfq_past_deadline", "quotation_missing"]) {
    const target = getFollowUpTarget({ type, rfq_id: "rfq-1", path: "/rfq/rfq-1" });
    expect(target).toEqual({ pathname: "/rfq/rfq-1" });
  }
});

test("approval follow-up opens the exact approval", () => {
  const target = getFollowUpTarget({ type: "pending_approval", approval_id: "appr-1", path: "/approvals" });
  expect(target).toEqual({ pathname: "/approvals", state: { approval_id: "appr-1" } });
});

test("PO/payment/receiving follow-ups open the exact PO in the right tab", () => {
  expect(getFollowUpTarget({ type: "delivery_problem", purchase_order_id: "po-1" }))
    .toEqual({ pathname: "/purchase-orders/po-1", search: "?section=receiving" });
  expect(getFollowUpTarget({ type: "partial_received", purchase_order_id: "po-1" }))
    .toEqual({ pathname: "/purchase-orders/po-1", search: "?section=receiving" });
  expect(getFollowUpTarget({ type: "overdue_payment", purchase_order_id: "po-1" }))
    .toEqual({ pathname: "/purchase-orders/po-1", search: "?section=payments" });
  expect(getFollowUpTarget({ type: "awaiting_supplier_confirmation", purchase_order_id: "po-1" }))
    .toEqual({ pathname: "/purchase-orders/po-1", search: "" });
});

test("falls back to the legacy path when a known type is missing its id (older/mocked payloads)", () => {
  expect(getFollowUpTarget({ type: "sourcing_required", path: "/incoming-requests" }))
    .toEqual({ pathname: "/incoming-requests" });
  expect(getFollowUpTarget({ type: "delivery_problem", path: "/purchase-orders/legacy-1" }))
    .toEqual({ pathname: "/purchase-orders/legacy-1" });
});

test("unknown/future action types fall back to the parent path instead of crashing", () => {
  expect(getFollowUpTarget({ type: "some_future_type", path: "/incoming-requests" }))
    .toEqual({ pathname: "/incoming-requests" });
  expect(getFollowUpTarget({ type: "some_future_type" })).toBeNull();
  expect(getFollowUpTarget(null)).toBeNull();
});
