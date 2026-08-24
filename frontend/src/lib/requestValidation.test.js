import {
  buildPublicRequestFormData,
  emptyRequestedItem,
  validatePublicRequest,
} from "@/lib/requestValidation";

const validForm = {
  requester_name: "أحمد علي",
  company_name: "شركة البناء",
  phone_number: "+201001234567",
  whatsapp_number: "+201001234567",
  email: "ahmed@example.com",
  project_name: "مشروع إداري",
  project_location: "القاهرة",
  delivery_location: "موقع المشروع",
  required_delivery_date: "2030-01-15",
  priority: "high",
  notes: "",
};

test("public request validation accepts required requester and item data", () => {
  const item = { ...emptyRequestedItem(), product_name: "أسمنت", quantity: "10", unit: "شيكارة" };
  expect(validatePublicRequest(validForm, [item], "2029-01-01")).toBeNull();
});

test("public request validation rejects missing fields and invalid quantities", () => {
  expect(validatePublicRequest({ ...validForm, requester_name: "" }, [], "2029-01-01"))
    .toBe("اسم مقدم الطلب مطلوب");
  const item = { ...emptyRequestedItem(), product_name: "أسمنت", quantity: "0", unit: "شيكارة" };
  expect(validatePublicRequest(validForm, [item], "2029-01-01"))
    .toBe("الكمية غير صحيحة في الصنف 1");
});

test("multipart payload indexes attachments without exposing file paths", () => {
  const file = new File(["image"], "sample.png", { type: "image/png" });
  const item = { ...emptyRequestedItem(), product_name: "دهان", quantity: "2", unit: "بستلة", attachment: file };
  const data = buildPublicRequestFormData(validForm, [item], "submission-token-123");
  const payload = JSON.parse(data.get("payload"));
  expect(payload.items[0].attachment_index).toBe(0);
  expect(payload.items[0].attachment).toBeUndefined();
  expect(data.getAll("attachments")).toHaveLength(1);
});

