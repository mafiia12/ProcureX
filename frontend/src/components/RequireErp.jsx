import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

// Global entry guard for the internal ERP shell. Frontend visibility is UX
// only — every ERP data endpoint's own server-side enforcement is added in
// Sprint 2.3; this guard's job is purely to stop an anonymous or
// site_portal browser session from ever rendering the ERP shell.
export default function RequireErp({ children }) {
  const { status, user } = useAuth();
  if (status === "checking") return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.account_type !== "erp") return <Navigate to="/request-purchase" replace />;
  return children;
}
