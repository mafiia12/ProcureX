import { useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  FileUp,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { publicRequestApi, requestError } from "@/lib/publicRequestApi";
import DocumentRequestForm from "@/components/DocumentRequestForm";
import PreferenceControls from "@/components/PreferenceControls";
import { usePreferences } from "@/contexts/PreferencesContext";
import {
  PRIORITY_OPTIONS,
  buildPublicRequestFormData,
  emptyRequestedItem,
  newSubmissionToken,
  validatePublicRequest,
} from "@/lib/requestValidation";

const initialForm = () => ({
  requester_name: "",
  company_name: "",
  phone_number: "",
  whatsapp_number: "",
  email: "",
  project_name: "",
  project_location: "",
  delivery_location: "",
  required_delivery_date: "",
  priority: "normal",
  notes: "",
});

const Field = ({ label, required, children, className = "" }) => (
  <div className={`min-w-0 space-y-1 ${className}`}>
    <Label className="text-xs font-medium text-slate-700">
      {label}
      {required && <span className="text-red-500"> *</span>}
    </Label>
    {children}
  </div>
);

export default function PublicPurchaseRequest() {
  const { direction, t } = usePreferences();
  const [entryMode, setEntryMode] = useState("manual");
  const [form, setForm] = useState(initialForm());
  const [items, setItems] = useState([emptyRequestedItem()]);
  const [submissionToken, setSubmissionToken] = useState(newSubmissionToken);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null);
  const minDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const setValue = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));
  const setItem = (index, key, value) =>
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    );

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    const validation = validatePublicRequest(form, items, minDate);
    if (validation) {
      setError(validation);
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const { data } = await publicRequestApi.post(
        "",
        buildPublicRequestFormData(form, items, submissionToken),
      );
      setSuccess(data);
    } catch (submitError) {
      setError(requestError(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const startAnother = () => {
    setForm(initialForm());
    setItems([emptyRequestedItem()]);
    setSubmissionToken(newSubmissionToken());
    setSuccess(null);
    setError("");
  };

  if (entryMode === "document") {
    return (
      <div
        className="min-h-screen bg-background"
        dir={direction}
        data-testid="public-document-request-page"
      >
        <header className="border-b bg-card">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <div className="font-bold">RE DECOR & MORE</div>
                <div className="text-xs text-muted-foreground">
                  {t("appName")}
                </div>
              </div>
            </div>
            <PreferenceControls compact />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">{t("document.title")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("document.intro")}
              </p>
            </div>
            <div className="flex rounded-lg border bg-card p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEntryMode("manual")}
              >
                {t("document.manualMode")}
              </Button>
              <Button type="button" size="sm">
                {t("document.uploadMode")}
              </Button>
            </div>
          </div>
          <DocumentRequestForm />
        </main>
      </div>
    );
  }

  if (success) {
    return (
      <div
        className="min-h-screen bg-slate-50 px-4 py-10 dark:bg-background"
        dir={direction}
        data-testid="public-request-success"
      >
        <div className="mx-auto max-w-xl rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
          <h1 className="mt-4 text-2xl font-bold text-slate-900">
            تم استلام طلب الشراء بنجاح
          </h1>
          <p className="mt-2 text-sm leading-7 text-slate-600">
            احتفظ بالرقم المرجعي التالي للتواصل والمتابعة.
          </p>
          <div
            className="mt-5 rounded-xl bg-blue-50 px-4 py-4 text-xl font-bold tracking-wide text-primary"
            data-testid="public-request-reference"
          >
            {success.request_number}
          </div>
          {success.duplicate && (
            <p className="mt-3 text-xs text-amber-700">
              تم التعرف على محاولة مكررة وعرض نفس الرقم المرجعي دون إنشاء طلب
              جديد.
            </p>
          )}
          <Button className="mt-6" variant="outline" onClick={startAnother}>
            إرسال طلب آخر
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-slate-50 dark:bg-background"
      dir={direction}
      data-testid="public-purchase-request-page"
    >
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="font-bold text-slate-900">RE DECOR & MORE</div>
              <div className="text-xs text-slate-500">
                {t("document.title")}
              </div>
            </div>
          </div>
          <PreferenceControls compact />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-slate-900">إرسال طلب شراء</h1>
          <p className="mt-1 text-sm text-slate-600">
            أدخل بيانات التواصل والمشروع والأصناف المطلوبة، وسيقوم فريق
            المشتريات بمراجعة الطلب.
          </p>
        </div>
        <div className="mb-4 flex flex-wrap gap-2 rounded-lg border bg-card p-1">
          <Button type="button" size="sm">
            {t("document.manualMode")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEntryMode("document")}
          >
            <FileUp className="me-2 h-4 w-4" />
            {t("document.uploadMode")}
          </Button>
        </div>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="mb-4 font-bold text-primary">بيانات مقدم الطلب</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="اسم مقدم الطلب" required>
                <Input
                  data-testid="requester-name-input"
                  value={form.requester_name}
                  onChange={(e) => setValue("requester_name", e.target.value)}
                  maxLength={160}
                />
              </Field>
              <Field label="اسم الشركة">
                <Input
                  value={form.company_name}
                  onChange={(e) => setValue("company_name", e.target.value)}
                  maxLength={180}
                />
              </Field>
              <Field label="رقم الهاتف" required>
                <Input
                  data-testid="request-phone-input"
                  type="tel"
                  value={form.phone_number}
                  onChange={(e) => setValue("phone_number", e.target.value)}
                  maxLength={30}
                />
              </Field>
              <Field label="رقم واتساب">
                <Input
                  type="tel"
                  value={form.whatsapp_number}
                  onChange={(e) => setValue("whatsapp_number", e.target.value)}
                  maxLength={30}
                />
              </Field>
              <Field label="البريد الإلكتروني">
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setValue("email", e.target.value)}
                  maxLength={254}
                />
              </Field>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="mb-4 font-bold text-primary">
              بيانات المشروع والتسليم
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="اسم المشروع" required>
                <Input
                  data-testid="request-project-input"
                  value={form.project_name}
                  onChange={(e) => setValue("project_name", e.target.value)}
                  maxLength={200}
                />
              </Field>
              <Field label="موقع المشروع" required>
                <Input
                  data-testid="request-project-location-input"
                  value={form.project_location}
                  onChange={(e) => setValue("project_location", e.target.value)}
                  maxLength={500}
                />
              </Field>
              <Field label="مكان التسليم" required>
                <Input
                  data-testid="request-delivery-location-input"
                  value={form.delivery_location}
                  onChange={(e) =>
                    setValue("delivery_location", e.target.value)
                  }
                  maxLength={500}
                />
              </Field>
              <Field label="تاريخ التسليم المطلوب" required>
                <Input
                  data-testid="request-delivery-date-input"
                  type="date"
                  min={minDate}
                  value={form.required_delivery_date}
                  onChange={(e) =>
                    setValue("required_delivery_date", e.target.value)
                  }
                />
              </Field>
              <Field label="الأولوية" required>
                <select
                  data-testid="request-priority-select"
                  className="h-9 w-full rounded-md border border-input bg-white px-3 text-sm"
                  value={form.priority}
                  onChange={(e) => setValue("priority", e.target.value)}
                >
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="ملاحظات" className="sm:col-span-2 lg:col-span-3">
                <Textarea
                  value={form.notes}
                  onChange={(e) => setValue("notes", e.target.value)}
                  maxLength={4000}
                  rows={3}
                />
              </Field>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-primary">الأصناف المطلوبة</h2>
                <p className="text-xs text-slate-500">
                  يمكن إضافة صورة أو ملف PDF لكل صنف عند الحاجة.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setItems((current) => [...current, emptyRequestedItem()])
                }
                disabled={items.length >= 20}
              >
                <Plus className="ms-1 h-4 w-4" /> إضافة صنف
              </Button>
            </div>
            <div className="space-y-3">
              {items.map((item, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-slate-200 bg-slate-50/60 p-3"
                  data-testid={`public-request-item-${index}`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-600">
                      الصنف {index + 1}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={`حذف الصنف ${index + 1}`}
                      onClick={() =>
                        setItems((current) =>
                          current.length > 1
                            ? current.filter(
                                (_, itemIndex) => itemIndex !== index,
                              )
                            : [emptyRequestedItem()],
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                    <Field
                      label="اسم المنتج"
                      required
                      className="lg:col-span-2"
                    >
                      <Input
                        data-testid={`requested-product-${index}`}
                        value={item.product_name}
                        onChange={(e) =>
                          setItem(index, "product_name", e.target.value)
                        }
                        maxLength={200}
                      />
                    </Field>
                    <Field label="العلامة التجارية المفضلة">
                      <Input
                        value={item.preferred_brand}
                        onChange={(e) =>
                          setItem(index, "preferred_brand", e.target.value)
                        }
                        maxLength={120}
                      />
                    </Field>
                    <Field label="التصنيف الرئيسي">
                      <Input
                        value={item.main_category}
                        onChange={(e) =>
                          setItem(index, "main_category", e.target.value)
                        }
                        maxLength={120}
                      />
                    </Field>
                    <Field label="التصنيف الفرعي">
                      <Input
                        value={item.subcategory}
                        onChange={(e) =>
                          setItem(index, "subcategory", e.target.value)
                        }
                        maxLength={120}
                      />
                    </Field>
                    <Field label="الكمية" required>
                      <Input
                        data-testid={`requested-quantity-${index}`}
                        type="number"
                        min="0"
                        step="any"
                        value={item.quantity}
                        onChange={(e) =>
                          setItem(index, "quantity", e.target.value)
                        }
                      />
                    </Field>
                    <Field label="الوحدة" required>
                      <Input
                        data-testid={`requested-unit-${index}`}
                        value={item.unit}
                        onChange={(e) => setItem(index, "unit", e.target.value)}
                        maxLength={50}
                      />
                    </Field>
                    <Field
                      label="المواصفات"
                      className="sm:col-span-2 lg:col-span-4"
                    >
                      <Textarea
                        value={item.specifications}
                        onChange={(e) =>
                          setItem(index, "specifications", e.target.value)
                        }
                        maxLength={2000}
                        rows={2}
                      />
                    </Field>
                    <Field
                      label="مرفق أو صورة"
                      className="sm:col-span-2 lg:col-span-4"
                    >
                      <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-600 hover:border-primary">
                        <FileUp className="h-4 w-4 text-primary" />
                        <span className="truncate">
                          {item.attachment?.name ||
                            "اختر صورة أو ملف PDF — بحد أقصى 5 ميجابايت"}
                        </span>
                        <input
                          className="sr-only"
                          type="file"
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          onChange={(e) =>
                            setItem(
                              index,
                              "attachment",
                              e.target.files?.[0] || null,
                            )
                          }
                        />
                      </label>
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <input
            type="text"
            name="website"
            className="hidden"
            tabIndex="-1"
            autoComplete="off"
            aria-hidden="true"
          />
          {error && (
            <div
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              role="alert"
              data-testid="public-request-error"
            >
              {error}
            </div>
          )}
          <div className="flex justify-end">
            <Button
              type="submit"
              className="min-w-44 gap-2"
              disabled={submitting}
              data-testid="submit-public-request"
            >
              <Send className="h-4 w-4" />{" "}
              {submitting ? "جارٍ الإرسال..." : "إرسال طلب الشراء"}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
