import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

// Route guard for the Admin user-management page. Frontend visibility is UX
// only — the backend independently enforces the same admin-only rule on
// every /api/admin/users endpoint (see auth/service.py:require_erp_role).
export default function RequireAdmin({ children }) {
  const { status, user } = useAuth();
  if (status === "checking") return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.account_type !== "erp" || user.role !== "admin") {
    return <Navigate to="/" replace />;
  }
  return children;
}
