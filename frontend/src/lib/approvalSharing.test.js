import { buildApprovalMessage, buildApprovalUrl, buildEmailUrl, buildWhatsAppUrl } from "./approvalSharing";

const approval = { approval_number: "APR-000001", project_name: "مشروع أ", comparison_number: "CMP-1", final_total: 1250, engineer_phone: "+20 100", engineer_email: "a@example.com" };

test("sharing helpers centralize the secure public URL", () => {
  const url = buildApprovalUrl("secure token", "https://erp.example/");
  expect(url).toBe("https://erp.example/approval/secure%20token");
  expect(buildApprovalMessage(approval, url)).toContain(url);
  expect(decodeURIComponent(buildWhatsAppUrl(approval, url))).toContain("APR-000001");
  expect(decodeURIComponent(buildEmailUrl(approval, url))).toContain("a@example.com");
});
