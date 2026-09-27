// Single deep-link contract for Dashboard "Needs my attention" follow-ups.
// Each known attention_items[].type maps to exactly one route builder here -
// Dashboard.jsx (and any other caller) must not hardcode route logic per type.
//
// A builder prefers the explicit entity id fields the backend now sends
// (purchase_order_id / rfq_id / request_id / approval_id) and falls back to
// the legacy `path` string only when those ids are absent, so older/mocked
// dashboard payloads still navigate correctly.

const purchaseOrderTarget = (section) => (item) => {
  if (item.purchase_order_id) {
    return {
      pathname: `/purchase-orders/${item.purchase_order_id}`,
      search: section ? `?section=${section}` : "",
    };
  }
  return item.path ? { pathname: item.path } : null;
};

const rfqTarget = (item) => (item.rfq_id
  ? { pathname: `/rfq/${item.rfq_id}` }
  : (item.path ? { pathname: item.path } : null));

const incomingRequestTarget = (item) => (item.request_id
  ? { pathname: "/incoming-requests", state: { request_id: item.request_id } }
  : (item.path ? { pathname: item.path } : null));

const approvalTarget = (item) => (item.approval_id
  ? { pathname: "/approvals", state: { approval_id: item.approval_id } }
  : (item.path ? { pathname: item.path } : null));

// One explicit entry per known backend action_type - see backend/server.py's
// attention_items builder (_dashboard_procurement_intelligence). No type is
// left to guess its route from the generic fallback below.
export const FOLLOW_UP_ROUTE_BUILDERS = {
  delivery_problem: purchaseOrderTarget("receiving"),
  overdue_payment: purchaseOrderTarget("payments"),
  partial_received: purchaseOrderTarget("receiving"),
  awaiting_supplier_confirmation: purchaseOrderTarget(),
  rfq_past_deadline: rfqTarget,
  quotation_missing: rfqTarget,
  sourcing_required: incomingRequestTarget,
  needs_clarification: incomingRequestTarget,
  request_review: incomingRequestTarget,
  pending_approval: approvalTarget,
};

export const KNOWN_FOLLOW_UP_TYPES = Object.keys(FOLLOW_UP_ROUTE_BUILDERS);

// Returns { pathname, search?, state? } or null when nothing safe to open.
export function getFollowUpTarget(item) {
  if (!item) return null;
  const builder = FOLLOW_UP_ROUTE_BUILDERS[item.type];
  const target = builder ? builder(item) : null;
  if (target) return target;
  return item.path ? { pathname: item.path } : null;
}
