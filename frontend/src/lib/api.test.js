import { errMsg, fmtEGP, fmtMoney } from "@/lib/api";

afterEach(() => localStorage.removeItem("procurex-language"));

test("HTTP 401 maps to a session/login-expired message, not the raw backend detail", () => {
  const message = errMsg({ response: { status: 401, data: { detail: "تسجيل الدخول مطلوب" } } });
  expect(message).toBe("انتهت جلسة تسجيل الدخول، يرجى تسجيل الدخول مرة أخرى");
});

test("HTTP 403 maps to a permission-denied message, never the login-required text", () => {
  const message = errMsg({ response: { status: 403, data: { detail: "صلاحياتك لا تسمح بتنفيذ هذا الإجراء" } } });
  expect(message).toBe("ليس لديك صلاحية لتنفيذ هذا الإجراء");
  expect(message).not.toContain("تسجيل الدخول");
});

test("other status codes still surface the real backend validation message", () => {
  const message = errMsg({ response: { status: 422, data: { detail: "سبب الرفض مطلوب" } } });
  expect(message).toBe("سبب الرفض مطلوب");
});

test("EGP formatting follows the active Arabic or English interface", () => {
  localStorage.setItem("procurex-language", "ar");
  expect(fmtEGP(5935)).toBe("5,935.00 ج.م");
  localStorage.setItem("procurex-language", "en");
  expect(fmtEGP(5935)).toBe("EGP 5,935.00");
});

test("project money formatting keeps Western digits and prefixes the currency", () => {
  expect(fmtMoney(3461.76)).toBe("ج.م 3,461.76");
  expect(fmtMoney(3461.76, "EGP")).toBe("EGP 3,461.76");
});
