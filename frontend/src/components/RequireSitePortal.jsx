import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

// Entry guard for the Site Request Portal. An ERP account is redirected to
// the internal app rather than shown the portal (V1 has no shared use
// case for an ERP user submitting through the portal). The backend enforces
// the same account_type/role/active check independently on every
// /api/portal/* endpoint (see auth/service.py:require_site_portal) — this
// guard only improves the UX, it is not the security boundary.
export default function RequireSitePortal({ children }) {
  const { status, user } = useAuth();
  if (status === "checking") return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.account_type !== "site_portal") return <Navigate to="/" replace />;
  return children;
}
