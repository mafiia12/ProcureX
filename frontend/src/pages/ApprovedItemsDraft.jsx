import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { internalRequestApi, requestError } from "@/lib/requestApi";
import api, { errMsg } from "@/lib/api";

export default function ApprovedItemsDraft() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState({});

  const loadItems = useCallback(async () => {
    setLoading(true);

    try {
      const { data } = await internalRequestApi.get("/approved/items");
      setItems(data);
    } catch (error) {
      toast.error(requestError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const updateDraft = (item, field, value) => {
    setDrafts((current) => ({
      ...current,
      [item.item_id]: {
        unit_price:
          current[item.item_id]?.unit_price ??
          item.approved_unit_price ??
          0,
        price_note:
          current[item.item_id]?.price_note ??
          item.approved_price_note ??
          "",
        [field]: value,
      },
    }));
  };

  const savePrice = async (item) => {
    const draft = drafts[item.item_id] || {
      unit_price: item.approved_unit_price || 0,
      price_note: item.approved_price_note || "",
    };

    try {
      // This endpoint requires a real ERP session (require_erp_role), not
      // the legacy internal-access token internalRequestApi sends - it must
      // go through the authenticated `api` client so the JWT is attached.
      await api.patch(
        `/internal/incoming-purchase-requests/${item.request_id}/items/${item.item_id}/approved-price`,
        {
          unit_price: Number(draft.unit_price || 0),
          price_note: draft.price_note || "",
          updated_by: "",
        },
      );

      toast.success("تم حفظ سعر الصنف");
      await loadItems();
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            مسودة الاعتمادات
          </h2>
          <p className="text-sm text-slate-500">
            الأصناف المعتمدة من طلبات الشراء الواردة.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={loadItems}>
          <RefreshCw className="ms-1 h-4 w-4" />
          تحديث
        </Button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        {loading && (
          <div className="p-8 text-center text-sm text-slate-500">
            جارٍ التحميل...
          </div>
        )}

        {!loading && !items.length && (
          <div className="p-8 text-center text-sm text-slate-500">
            لا توجد أصناف معتمدة حالياً.
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-3 py-3 text-start">رقم الطلب</th>
                  <th className="px-3 py-3 text-start">المشروع</th>
                  <th className="px-3 py-3 text-start">مقدم الطلب</th>
                  <th className="px-3 py-3 text-start">الصنف</th>
                  <th className="px-3 py-3 text-start">الكمية</th>
                  <th className="px-3 py-3 text-start">سعر الوحدة</th>
                  <th className="px-3 py-3 text-start">الإجمالي</th>
                  <th className="px-3 py-3 text-start">ملاحظة السعر</th>
                  <th className="px-3 py-3 text-start">الحالة</th>
                  <th className="px-3 py-3 text-start">الإجراء</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {items.map((item) => {
                  const unitPrice =
                    drafts[item.item_id]?.unit_price ??
                    item.approved_unit_price ??
                    0;

                  const priceNote =
                    drafts[item.item_id]?.price_note ??
                    item.approved_price_note ??
                    ""; 

                  const total =
                    Number(item.quantity || 0) *
                    Number(unitPrice || 0);

                  const rowStyle = {
                    approved: "bg-emerald-50",
                    rejected: "bg-red-50",
                    need_clarification: "bg-blue-50",
                    hold: "bg-amber-50",
                    pending: "bg-slate-50",
                  }[item.review_status] || "bg-white";

                  const statusText = {
                    approved: "معتمد",
                    rejected: "مرفوض",
                    need_clarification: "يحتاج استكمال",
                    hold: "معلّق",
                    pending: "قيد المراجعة",
                  }[item.review_status] || item.review_status;

                return (
                <tr
                    key={item.item_id}
                    className={{
                    approved: "bg-emerald-50",
                    rejected: "bg-red-50",
                    need_clarification: "bg-blue-50",
                    pending: "bg-slate-50",
                    hold: "bg-amber-50",
                    }[item.review_status] || "bg-white"}
                    >
                
                      <td className="px-3 py-3 font-medium">
                        {item.request_number}
                      </td>

                      <td className="px-3 py-3">
                        {item.project_name || "-"}
                      </td>

                      <td className="px-3 py-3">
                        {item.requester_name || "-"}
                      </td>

                      <td className="px-3 py-3">
                        <div className="font-medium text-slate-800">
                          {item.product_name}
                        </div>

                        {item.specifications && (
                          <div className="mt-1 text-xs text-slate-500">
                            {item.specifications}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-3 whitespace-nowrap">
                        {item.quantity} {item.unit}
                      </td>

                      <td className="px-3 py-3">
                       <Input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={item.review_status !== "approved"}
                          className="min-w-[120px]"
                          value={unitPrice}
                          onChange={(event) =>
                            updateDraft(
                              item,
                              "unit_price",
                              event.target.value,
                            )
                          }
                        />
                      </td>

                      <td className="px-3 py-3 whitespace-nowrap font-bold text-slate-800">
                        {total.toLocaleString("ar-EG", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>

                      <td className="px-3 py-3">
                        <Textarea
                          rows={2}
                          className="min-w-[220px]"
                          disabled={item.review_status !== "approved"}
                          value={priceNote}
                          onChange={(event) =>
                            updateDraft(
                              item,
                              "price_note",
                              event.target.value,
                            )
                          }
                          placeholder="ملاحظة السعر"
                        />
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="font-bold">
                          {statusText}
                        </span>
                      </td>

                      <td className="px-3 py-3">
                        <Button
                          size="sm"
                          disabled={item.review_status !== "approved"}
                          onClick={() => savePrice(item)}
                        >
                          <Save className="ms-1 h-4 w-4" />
                          حفظ
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}