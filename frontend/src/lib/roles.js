// Mirrors backend/auth/service.py's ERP role hierarchy so frontend action
// visibility matches what the backend will actually allow. Backend RBAC
// remains authoritative - this only avoids showing a control a role
// couldn't actually use.
//
// site_engineer/site_portal is deliberately NOT a key here: that surface
// stays fully outside ERP role inheritance.
export const ERP_ROLE_LEVELS = Object.freeze({
  procurement_engineer: 10,
  procurement_responsible: 20,
  commercial_manager: 30,
  admin: 100,
});

// True if `actualRole` sits at or above `requiredRole` in the ERP hierarchy.
// Admin is an absolute override (also covers a `requiredRole` that predates
// the hierarchy, e.g. a workflow-stage value like "procurement_officer").
// Fails closed: an unrecognized role on either side never grants access.
export function roleAtLeast(actualRole, requiredRole) {
  if (actualRole === "admin") return true;
  const actualLevel = ERP_ROLE_LEVELS[actualRole];
  const requiredLevel = ERP_ROLE_LEVELS[requiredRole];
  if (actualLevel === undefined || requiredLevel === undefined) return false;
  return actualLevel >= requiredLevel;
}

// Like `roleAtLeast`, scoped to a `user` object from AuthContext - also
// enforces the account_type boundary so a site_portal user never inherits
// ERP access no matter what role string it carries.
export function hasRoleOrHigher(user, requiredRole) {
  return user?.account_type === "erp" && roleAtLeast(user.role, requiredRole);
}
