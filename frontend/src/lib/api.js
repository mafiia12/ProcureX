import axios from "axios";

// REACT_APP_BACKEND_URL is inlined at build time (Create React App), so a
// value baked in here is shared by every device that loads this bundle - a
// loopback or LAN-IP default breaks any device other than the one it names.
// Leaving it unset makes every request same-origin (a relative "/api" path,
// resolved by the browser against whatever origin served the page) instead:
// the dev server proxies "/api" to the local backend (see src/setupProxy.js),
// so the same build works unmodified from localhost, a LAN IP, or a single
// Cloudflare tunnel URL pointed at the frontend, with the backend's address
// never exposed to the browser. Set REACT_APP_BACKEND_URL only for the rare
// case where the frontend and backend are deliberately served from different
// origins.
const resolveBackendUrl = () => process.env.REACT_APP_BACKEND_URL || "";

export const BACKEND_URL = resolveBackendUrl().replace(/\/+$/, "");

// Without a timeout, axios waits forever on a stuck/hung backend request -
// the UI just spins with no error and no way for the user to know
// something is wrong (see docs/performance-reliability-audit.md). 30s
// matches publicRequestApi's existing timeout.
const api = axios.create({ baseURL: `${BACKEND_URL}/api`, timeout: 30_000 });

api.interceptors.request.use((config) => {
  const token = typeof window !== "undefined"
    ? window.sessionStorage.getItem("incoming_request_internal_token")
    : "";
  if (token && (
    String(config.url || "").startsWith("/workflow/")
    || String(config.url || "").startsWith("/internal/")
  )) {
    config.headers["X-Internal-Token"] = token;
  }
  const authToken = typeof window !== "undefined"
    ? window.localStorage.getItem("procurex-auth-token")
    : "";
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

export const fmt = (n) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

export const fmtMoney = (n, currency = "ج.م") => `${currency} ${fmt(n)}`;

export const fmtEGP = (n) => {
  const language = typeof window !== "undefined"
    ? window.localStorage.getItem("procurex-language")
    : "ar";
  return language === "en" ? `EGP ${fmt(n)}` : `${fmt(n)} ج.م`;
};

export const STATUS_STYLES = {
  "مدفوع": "bg-emerald-100 text-emerald-800",
  "مدفوع جزئي": "bg-amber-100 text-amber-800",
  "غير مدفوع": "bg-red-100 text-red-700",
};

const localizedError = (ar, en) =>
  document.documentElement.lang === "en" ? en : ar;

export const errMsg = (error) => {
  const status = error?.response?.status;
  // 401 (no/invalid/expired session) and 403 (authenticated but not
  // permitted) are distinct failures and must never share one message -
  // showing "please log in" for a 403 wrongly tells an already-logged-in
  // user their session is the problem.
  if (status === 401) {
    return localizedError(
      "انتهت جلسة تسجيل الدخول، يرجى تسجيل الدخول مرة أخرى",
      "Your session has expired. Please log in again.",
    );
  }
  if (status === 403) {
    return localizedError(
      "ليس لديك صلاحية لتنفيذ هذا الإجراء",
      "You do not have permission to perform this action.",
    );
  }
  const detail = error?.response?.data?.detail;
  if (detail && typeof detail === "object") {
    if (detail.code === "duplicate_supplier_invoice") {
      const reference = detail.existing_purchase_id
        ? ` (${localizedError("العملية", "purchase")}: ${detail.existing_purchase_id})`
        : "";
      return `${localizedError("رقم الفاتورة مسجل بالفعل لنفس المورد", "This invoice already exists for the selected supplier")}${reference}`;
    }
    if (detail.code === "internal_error") {
      return localizedError(
        "تعذر إكمال العملية. راجع السجلات المحلية ثم أعد المحاولة.",
        "The operation could not be completed. Check the local logs and try again.",
      );
    }
    if (typeof detail.message === "string") return detail.message;
  }
  if (typeof detail === "string" && error?.response?.status < 500) return detail;
  if (!error?.response) {
    return localizedError(
      "تعذر الاتصال بخدمة ProcureX. تأكد من تشغيل البرنامج ثم أعد المحاولة.",
      "Could not connect to ProcureX. Make sure the application is running and try again.",
    );
  }
  return localizedError(
    "تعذر إكمال العملية. أعد المحاولة، وإن استمرت المشكلة راجع السجلات المحلية.",
    "The operation could not be completed. Try again, then check the local logs if it persists.",
  );
};

export default api;
