import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const { login, isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const destinationFor = (account) => (account.account_type === "site_portal" ? "/request-purchase" : "/");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const loggedInUser = await login(username, password);
      navigate(destinationFor(loggedInUser));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (isAuthenticated && user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50" dir="rtl">
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-8 w-full max-w-sm text-center space-y-4">
          <p className="text-sm text-slate-600">
            مسجل الدخول باسم <span className="font-semibold text-slate-900">{user.display_name || user.username}</span>
          </p>
          <div className="flex gap-2 justify-center">
            <Button onClick={() => navigate(destinationFor(user))}>متابعة</Button>
            <Button variant="outline" data-testid="login-logout-button" onClick={logout}>
              تسجيل الخروج
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50" dir="rtl">
      <form
        onSubmit={submit}
        data-testid="login-page"
        className="bg-white border border-slate-200 rounded-lg shadow-sm p-8 w-full max-w-sm space-y-4"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-md bg-primary flex items-center justify-center">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <div className="font-bold text-slate-900" style={{ fontFamily: "Cairo" }}>
            RE DECOR & MORE
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="login-username">اسم المستخدم</Label>
          <Input
            id="login-username"
            data-testid="login-username-input"
            value={username}
            autoFocus
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="login-password">كلمة المرور</Label>
          <Input
            id="login-password"
            data-testid="login-password-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p className="text-xs text-red-600" role="alert" data-testid="login-error">
            {error}
          </p>
        )}
        <Button
          type="submit"
          data-testid="login-submit-button"
          className="w-full"
          disabled={submitting || !username || !password}
        >
          {submitting ? "جارٍ الدخول..." : "تسجيل الدخول"}
        </Button>
      </form>
    </div>
  );
}
