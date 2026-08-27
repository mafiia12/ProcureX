import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import ApprovalsCommandCenter from "@/pages/ApprovalsCommandCenter";
import { APPROVAL_STAGES, APPROVAL_STAGE_LABELS } from "@/lib/approvalStages";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mockApproval;
let mockWorkspace;
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockNavigate = jest.fn();

const emptyWorkspace = {
  request: null, request_items: [], request_attachments: [],
  technical_review: null, rfq: null, supplier_quotations: [], comparison: null,
};

jest.mock("react-router-dom", () => ({
  useLocation: () => ({ state: { approval_id: "apr-1" } }),
  useNavigate: () => mockNavigate,
}), { virtual: true });
jest.mock("@/lib/api", () => ({
  __esModule: true, fmtEGP: (value) => `${value} ج.م`, errMsg: () => "خطأ",
  default: { get: (...args) => mockGet(...args), post: (...args) => mockPost(...args) },
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
const mockUseAuth = jest.fn();
jest.mock("@/contexts/AuthContext", () => ({ useAuth: (...a) => mockUseAuth(...a) }));

const approvalBase = {
  id: "apr-1", approval_number: "APR-1", comparison_id: "cmp-1", comparison_number: "CMP-1",
  source_request_number: "REQ-1", approval_type: "comparison_workflow", revision_number: 0,
  project_name: "مشروع أ", final_total: 1000, timeline: [],
};

async function renderCenter(role = "procurement_engineer") {
  mockUseAuth.mockReturnValue({ user: { username: "user1", role, account_type: "erp" } });
  mockGet.mockImplementation((path) => Promise.resolve({
    data: path === "/workflow/approvals"
      ? { items: [mockApproval], counts: {}, payment_counts: {} }
      : path.endsWith("/review-workspace")
        ? (mockWorkspace || emptyWorkspace)
        : mockApproval,
  }));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ApprovalsCommandCenter />);
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  return { container, root };
}

async function click(element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockWorkspace = undefined;
  mockPost.mockReset();
  mockPost.mockResolvedValue({ data: { approval: { ...approvalBase } } });
});

test("keeps expenditure approval and funds availability semantics distinct", async () => {
  expect(APPROVAL_STAGES.EXPENDITURE_APPROVAL).toBe("fund_release");
  expect(APPROVAL_STAGES.FUNDS_AVAILABILITY).toBe("funds_release");
  expect(APPROVAL_STAGE_LABELS[APPROVAL_STAGES.EXPENDITURE_APPROVAL]).toContain("التجارية");
  expect(APPROVAL_STAGE_LABELS[APPROVAL_STAGES.FUNDS_AVAILABILITY]).toContain("إتاحة");

  mockApproval = { ...approvalBase, status: "pending_approval", approval_stage: APPROVAL_STAGES.FUNDS_AVAILABILITY, responsible_role: "commercial_manager" };
  const engineerView = await renderCenter("procurement_engineer");
  expect(engineerView.container.textContent).toContain("الموافقة التجارية / اعتماد الصرف مكتمل — المبلغ لم يُتح بعد");
  expect(engineerView.container.textContent).toContain("تأكيد إتاحة / تسليم المبلغ");
  expect(engineerView.container.textContent).not.toContain("تأكيد إتاحة المبلغ لمسؤول المشتريات");
  await act(async () => engineerView.root.unmount());
  engineerView.container.remove();

  const { container, root } = await renderCenter("commercial_manager");
  expect(container.textContent).toContain("تأكيد إتاحة المبلغ لمسؤول المشتريات");
  await act(async () => root.unmount());
  container.remove();
});

test("offers PO creation to procurement_responsible only after funds release", async () => {
  mockApproval = { ...approvalBase, status: "approved", approval_stage: APPROVAL_STAGES.PO_READY, responsible_role: "procurement_officer" };
  mockPost.mockResolvedValue({ data: { count: 1, purchase_orders: [{ id: "po-1" }] } });

  const engineerView = await renderCenter("procurement_engineer");
  expect(engineerView.container.textContent).toContain("🟢 التمويل متاح");
  expect(engineerView.container.textContent).not.toContain("إنشاء أوامر الشراء للمراجعة");
  await act(async () => engineerView.root.unmount());
  engineerView.container.remove();

  const { container, root } = await renderCenter("procurement_responsible");
  const create = [...container.querySelectorAll("button")]
    .find((button) => button.textContent.includes("إنشاء أوامر الشراء للمراجعة"));
  expect(create).toBeDefined();
  await act(async () => {
    create.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(mockPost).toHaveBeenCalledWith("/purchase-orders/from-comparison", expect.objectContaining({
    comparison_id: "cmp-1", orders: [],
  }));
  expect(mockNavigate).toHaveBeenCalledWith("/purchase-orders/po-1");
  await act(async () => root.unmount());
  container.remove();
});

test("shows a completed state instead of a re-clickable CTA once a purchase order already exists", async () => {
  mockApproval = {
    ...approvalBase, status: "approved", approval_stage: APPROVAL_STAGES.PO_READY,
    responsible_role: "procurement_officer",
    purchase_orders: [{ id: "po-1", po_number: "PO-000001", status: "draft" }],
  };
  const { container, root } = await renderCenter("procurement_responsible");

  expect(container.textContent).toContain("تم إنشاء أمر الشراء");
  expect(container.textContent).not.toContain("🟢 التمويل متاح");
  expect([...container.querySelectorAll("button")].some((b) => b.textContent.includes("إنشاء أوامر الشراء للمراجعة"))).toBe(false);

  const open = container.querySelector('[data-testid="open-created-purchase-orders"]');
  expect(open.textContent).toContain("فتح أمر الشراء");
  await click(open);
  expect(mockNavigate).toHaveBeenCalledWith("/purchase-orders/po-1");
  expect(mockPost).not.toHaveBeenCalledWith("/purchase-orders/from-comparison", expect.anything());

  await act(async () => root.unmount());
  container.remove();
});

test("offers a view-all action when an approval already produced multiple purchase orders", async () => {
  mockApproval = {
    ...approvalBase, status: "approved", approval_stage: APPROVAL_STAGES.PO_READY,
    responsible_role: "procurement_officer",
    purchase_orders: [
      { id: "po-1", po_number: "PO-000001", status: "draft" },
      { id: "po-2", po_number: "PO-000002", status: "draft" },
    ],
  };
  const { container, root } = await renderCenter("procurement_responsible");

  const open = container.querySelector('[data-testid="open-created-purchase-orders"]');
  expect(open.textContent).toContain("عرض أوامر الشراء (2)");
  await click(open);
  expect(mockNavigate).toHaveBeenCalledWith("/purchase-orders");

  await act(async () => root.unmount());
  container.remove();
});

// ---------------- Sprint 3.2: Comparison + Approval Review Workspace ----------------

const richWorkspace = {
  request: {
    id: "req-1", requester_name: "مهندس الموقع", requester_type: "site_portal",
    project_name: "مشروع أ", required_delivery_date: "2026-09-01", priority: "normal",
    delivery_destination: "site", notes: "",
  },
  request_items: [{
    id: "item-1", product_name: "أسمنت", specifications: "رتبة 42.5", quantity: 10, unit: "شيكارة",
    is_manual: false, review_status: "approved", review_reason: "",
  }],
  request_attachments: [{
    id: "att-1", original_filename: "invoice.pdf", media_type: "application/pdf",
    size_bytes: 20480, source: "general",
  }],
  technical_review: { reviewed: true, reviewed_by: "مهندس فني", reviewed_at: "2026-08-20T10:00:00Z" },
  rfq: {
    id: "rfq-1", rfq_number: "RFQ-000001", deadline: "2026-09-01",
    supplier_count: 2, received_quotation_count: 1,
    suppliers: [
      { supplier_id: "sup-1", supplier_name: "مورد أ" },
      { supplier_id: "sup-2", supplier_name: "مورد ب" },
    ],
  },
  supplier_quotations: [{
    id: "quo-1", supplier_name: "مورد أ", status: "received", quotation_ref: "SUP-REF-1",
    quotation_date: "2026-08-18", valid_until: "2026-09-10", payment_terms: "آجل 30 يوم",
    delivery_terms: "",
    lines: [{
      rfq_item_id: "rfqi-1", product_name: "أسمنت", quantity: 10, unit: "شيكارة",
      unit_price: 55, availability: "available",
    }],
    attachments: [{ id: "qatt-1", original_filename: "quote.pdf", media_type: "application/pdf", size_bytes: 1024 }],
  }],
  comparison: {
    comparison_number: "CMP-000001",
    product_summaries: [{ item_id: "item-1", item_code: "", product_name: "أسمنت" }],
    rows: [
      {
        id: "row-1", item_id: "item-1", supplier_name: "مورد أ", quantity: 10, unit_price: 55,
        discount_pct: 0, tax_pct: 0, final_total: 550, availability: "available",
        price_valid_until: "2099-12-31", selected_for_purchase: 1,
      },
      {
        id: "row-2", item_id: "item-1", supplier_name: "مورد ب", quantity: 10, unit_price: 60,
        discount_pct: 0, tax_pct: 0, final_total: 600, availability: "available",
        price_valid_until: "2099-12-31", selected_for_purchase: 0,
      },
    ],
  },
};

const TECHNICAL_STAGE_APPROVAL = {
  ...approvalBase, status: "pending_approval",
  approval_stage: APPROVAL_STAGES.COMPARISON_TECHNICAL, responsible_role: "procurement_engineer",
};
const COMMERCIAL_STAGE_APPROVAL = {
  ...approvalBase, status: "pending_approval",
  approval_stage: APPROVAL_STAGES.EXPENDITURE_APPROVAL, responsible_role: "commercial_manager",
};

async function setTextareaValue(textarea, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, "value",
  ).set;
  await act(async () => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("workspace renders the REQ section", async () => {
  mockApproval = TECHNICAL_STAGE_APPROVAL;
  mockWorkspace = richWorkspace;
  const { container, root } = await renderCenter("procurement_engineer");

  const section = container.querySelector('[data-testid="review-workspace-request"]');
  expect(section).not.toBeNull();
  expect(section.textContent).toContain("مهندس الموقع");
  expect(container.querySelectorAll('[data-testid="review-workspace-request-item"]').length).toBe(1);
  expect(section.textContent).toContain("أسمنت");

  await act(async () => root.unmount());
  container.remove();
});

test("keeps the current decision ahead of compact supporting detail", async () => {
  mockApproval = TECHNICAL_STAGE_APPROVAL;
  mockWorkspace = richWorkspace;
  const { container, root } = await renderCenter("procurement_engineer");

  expect(container.querySelector('[data-testid="approval-command-header"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="approval-decision-summary"]').children).toHaveLength(6);
  expect(container.querySelector('[data-testid="approval-progress-inline"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="approval-next-decision"]')).not.toBeNull();
  const actions = container.querySelector('[data-testid="approval-decision-actions"]');
  expect(actions).not.toBeNull();
  expect(actions.querySelector("button").classList.contains("h-8")).toBe(true);
  expect(container.querySelector('[data-testid="review-workspace"]').classList.contains("p-2")).toBe(true);

  await act(async () => root.unmount());
  container.remove();
});

test("RFQ section renders when present", async () => {
  mockApproval = TECHNICAL_STAGE_APPROVAL;
  mockWorkspace = richWorkspace;
  const { container, root } = await renderCenter("procurement_engineer");

  const rfqSection = container.querySelector('[data-testid="review-workspace-rfq"]');
  expect(rfqSection.textContent).toContain("RFQ-000001");
  expect(rfqSection.textContent).toContain("مورد أ");
  expect(rfqSection.textContent).toContain("مورد ب");

  await act(async () => root.unmount());
  container.remove();
});

test("a missing RFQ renders a neutral message instead of crashing", async () => {
  mockApproval = TECHNICAL_STAGE_APPROVAL;
  mockWorkspace = emptyWorkspace;
  const { container, root } = await renderCenter("procurement_engineer");

  expect(container.querySelector('[data-testid="review-workspace-no-rfq"]').textContent)
    .toBe("لم يتم إنشاء RFQ لهذا الطلب");

  await act(async () => root.unmount());
  container.remove();
});

test("supplier quotations render supplier name and prices", async () => {
  mockApproval = TECHNICAL_STAGE_APPROVAL;
  mockWorkspace = richWorkspace;
  const { container, root } = await renderCenter("procurement_engineer");

  const quotationsSection = container.querySelector('[data-testid="review-workspace-quotations"]');
  expect(quotationsSection.textContent).toContain("مورد أ");
  expect(quotationsSection.textContent).toContain("SUP-REF-1");
  expect(quotationsSection.textContent).toContain("55 ج.م");

  await act(async () => root.unmount());
  container.remove();
});

test("request and quotation attachments render with filenames", async () => {
  mockApproval = TECHNICAL_STAGE_APPROVAL;
  mockWorkspace = richWorkspace;
  const { container, root } = await renderCenter("procurement_engineer");

  expect(container.querySelector('[data-testid="request-attachment-row"]').textContent).toContain("invoice.pdf");
  expect(container.querySelector('[data-testid="quotation-attachment-link"]').textContent).toContain("quote.pdf");

  await act(async () => root.unmount());
  container.remove();
});

describe("supplier quotation attachment open/download", () => {
  const ATTACHMENT_PATH = "/workflow/rfqs/rfq-1/quotations/quo-1/attachments/qatt-1";
  let originalOpen;
  let originalCreateObjectURL;
  let originalRevokeObjectURL;

  beforeEach(() => {
    originalOpen = window.open;
    originalCreateObjectURL = window.URL.createObjectURL;
    originalRevokeObjectURL = window.URL.revokeObjectURL;
    window.open = jest.fn();
    window.URL.createObjectURL = jest.fn(() => "blob:mock-url");
    window.URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    window.open = originalOpen;
    window.URL.createObjectURL = originalCreateObjectURL;
    window.URL.revokeObjectURL = originalRevokeObjectURL;
  });

  async function renderWithAttachmentResponse(respond) {
    mockApproval = TECHNICAL_STAGE_APPROVAL;
    mockWorkspace = richWorkspace;
    const { container, root } = await renderCenter("procurement_engineer");
    const baseImpl = mockGet.getMockImplementation();
    mockGet.mockImplementation((path, config) => (
      path === ATTACHMENT_PATH ? respond(path, config) : baseImpl(path, config)
    ));
    return { container, root };
  }

  test("opens a PDF attachment in a new tab once a valid blob is confirmed", async () => {
    const blob = new Blob(["%PDF-1.4 fake"], { type: "application/pdf" });
    const { container, root } = await renderWithAttachmentResponse(() => Promise.resolve({ data: blob }));

    await click(container.querySelector('[data-testid="quotation-attachment-link"]'));

    expect(mockGet).toHaveBeenCalledWith(ATTACHMENT_PATH, expect.objectContaining({ responseType: "blob" }));
    expect(window.URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(window.open).toHaveBeenCalledWith("blob:mock-url", "_blank", "noopener,noreferrer");

    await act(async () => root.unmount());
    container.remove();
  });

  test("downloads a non-viewable attachment (e.g. xlsx) with its original filename instead of opening a tab", async () => {
    mockApproval = TECHNICAL_STAGE_APPROVAL;
    mockWorkspace = {
      ...richWorkspace,
      supplier_quotations: [{
        ...richWorkspace.supplier_quotations[0],
        attachments: [{
          id: "qatt-1", original_filename: "quote.xlsx",
          media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size_bytes: 2048,
        }],
      }],
    };
    const blob = new Blob(["xlsx-bytes"], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { container, root } = await renderCenter("procurement_engineer");
    const baseImpl = mockGet.getMockImplementation();
    mockGet.mockImplementation((path, config) => (
      path === ATTACHMENT_PATH ? Promise.resolve({ data: blob }) : baseImpl(path, config)
    ));

    await click(container.querySelector('[data-testid="quotation-attachment-link"]'));

    expect(window.open).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);

    clickSpy.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  });

  test("an API failure never opens a tab and shows the required toast instead of a stuck about:blank", async () => {
    const { container, root } = await renderWithAttachmentResponse(() => Promise.reject({ response: { status: 500 } }));

    await click(container.querySelector('[data-testid="quotation-attachment-link"]'));

    expect(window.open).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("تعذر فتح مرفق عرض المورد");

    await act(async () => root.unmount());
    container.remove();
  });

  test("an empty blob response is treated as a failure, not opened as a tab", async () => {
    const emptyBlob = new Blob([], { type: "application/pdf" });
    const { container, root } = await renderWithAttachmentResponse(() => Promise.resolve({ data: emptyBlob }));

    await click(container.querySelector('[data-testid="quotation-attachment-link"]'));

    expect(window.open).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("تعذر فتح مرفق عرض المورد");

    await act(async () => root.unmount());
    container.remove();
  });

  test.each([401, 403])("a %i on the attachment request uses the authenticated client and shows an error, not a blank tab", async (status) => {
    const { container, root } = await renderWithAttachmentResponse(() => Promise.reject({ response: { status } }));

    await click(container.querySelector('[data-testid="quotation-attachment-link"]'));

    expect(mockGet).toHaveBeenCalledWith(ATTACHMENT_PATH, expect.objectContaining({ responseType: "blob" }));
    expect(window.open).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("تعذر فتح مرفق عرض المورد");

    await act(async () => root.unmount());
    container.remove();
  });
});

test("the currently selected comparison row is visibly highlighted", async () => {
  mockApproval = TECHNICAL_STAGE_APPROVAL;
  mockWorkspace = richWorkspace;
  const { container, root } = await renderCenter("procurement_engineer");

  const rows = [...container.querySelectorAll('[data-testid="review-workspace-comparison-row"]')];
  expect(rows.length).toBe(2);
  const selectedRow = rows.find((row) => row.textContent.includes("مورد أ"));
  const otherRow = rows.find((row) => row.textContent.includes("مورد ب"));
  expect(selectedRow.className).toContain("bg-emerald-50");
  expect(selectedRow.textContent).toContain("✓ محدد للشراء");
  expect(otherRow.className).not.toContain("bg-emerald-50");

  await act(async () => root.unmount());
  container.remove();
});

test("procurement_engineer sees technical decision controls at the comparison-technical stage", async () => {
  mockApproval = TECHNICAL_STAGE_APPROVAL;
  const { container, root } = await renderCenter("procurement_engineer");

  expect([...container.querySelectorAll("button")].some((b) => b.textContent.includes("اعتماد المقارنة"))).toBe(true);

  await act(async () => root.unmount());
  container.remove();
});

test("commercial_manager does not see the engineer's technical decision controls", async () => {
  mockApproval = TECHNICAL_STAGE_APPROVAL;
  const { container, root } = await renderCenter("commercial_manager");

  expect([...container.querySelectorAll("button")].some((b) => b.textContent.includes("اعتماد المقارنة"))).toBe(false);
  expect(container.textContent).toContain("يمكنك مشاهدة المسار");

  await act(async () => root.unmount());
  container.remove();
});

test("commercial_manager sees commercial decision controls at the commercial stage", async () => {
  mockApproval = COMMERCIAL_STAGE_APPROVAL;
  const { container, root } = await renderCenter("commercial_manager");

  expect([...container.querySelectorAll("button")].some((b) => b.textContent.includes("موافقة تجارية"))).toBe(true);

  await act(async () => root.unmount());
  container.remove();
});

test("procurement_responsible sees the file but no unauthorized approval controls", async () => {
  mockApproval = TECHNICAL_STAGE_APPROVAL;
  mockWorkspace = richWorkspace;
  const { container, root } = await renderCenter("procurement_responsible");

  expect(container.querySelector('[data-testid="review-workspace"]')).not.toBeNull();
  expect([...container.querySelectorAll("button")].some((b) => b.textContent.includes("اعتماد المقارنة"))).toBe(false);
  expect(container.textContent).toContain("يمكنك مشاهدة المسار");

  await act(async () => root.unmount());
  container.remove();
});

test("clicking Approve opens a confirmation dialog instead of deciding immediately", async () => {
  mockApproval = TECHNICAL_STAGE_APPROVAL;
  const { container, root } = await renderCenter("procurement_engineer");

  const approveButton = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("اعتماد المقارنة"));
  await click(approveButton);

  expect(document.querySelector('[data-testid="decision-confirm-dialog"]')).not.toBeNull();
  expect(mockPost).not.toHaveBeenCalledWith(expect.stringContaining("/decision"), expect.anything());

  await act(async () => root.unmount());
  container.remove();
});

test("reject/revision requires a note before the confirmation dialog submits", async () => {
  mockApproval = TECHNICAL_STAGE_APPROVAL;
  const { container, root } = await renderCenter("procurement_engineer");

  const rejectButton = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("رفض"));
  await click(rejectButton);

  await click(document.querySelector('[data-testid="decision-confirm-button"]'));
  expect(mockPost).not.toHaveBeenCalledWith(expect.stringContaining("/decision"), expect.anything());

  await setTextareaValue(document.querySelector('[data-testid="decision-note-input"]'), "السعر غير مناسب");
  await click(document.querySelector('[data-testid="decision-confirm-button"]'));

  expect(mockPost).toHaveBeenCalledWith(
    "/workflow/approvals/apr-1/decision",
    expect.objectContaining({ decision: "rejected", note: "السعر غير مناسب" }),
  );

  await act(async () => root.unmount());
  container.remove();
});
