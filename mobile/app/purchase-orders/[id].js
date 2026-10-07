import { router, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import ActionsPlaceholder from '../../components/ActionsPlaceholder';
import Card from '../../components/Card';
import ErrorBanner from '../../components/ErrorBanner';
import InfoRow from '../../components/InfoRow';
import ProgressBar from '../../components/ProgressBar';
import Screen from '../../components/Screen';
import SectionTitle from '../../components/SectionTitle';
import SkeletonLoader from '../../components/SkeletonLoader';
import StatusBadge from '../../components/StatusBadge';
import { COLORS, FONT, SPACING } from '../../constants/theme';
import useApiData from '../../hooks/useApiData';
import { purchaseOrdersAPI } from '../../services/api';
import {
  formatCount,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPercent,
  formatQuantity,
} from '../../utils/formatters';

// Shapes: GET /api/purchase-orders/{id} (server._purchase_order_detail) has no
// payment figures; those come from GET /api/purchase-orders/{id}/payments.
const RECEIPT_TYPE_LABELS = { full: 'استلام كامل', partial: 'استلام جزئي', problem: 'مشكلة توريد' };
const PAYMENT_ROW_LABELS = { recorded: ['مسجلة', 'success'], voided: ['ملغاة', 'neutral'] };

function ItemRow({ item, last }) {
  const ordered = Number(item.quantity || 0);
  const received = Number(item.received_quantity || 0);
  return (
    <View style={[styles.item, last && styles.itemLast]}>
      <View style={styles.itemTop}>
        <Text style={styles.itemName}>{item.product_name || '—'}</Text>
        <Text style={styles.itemTotal}>{formatCurrency(item.line_total)}</Text>
      </View>
      <Text style={styles.itemMeta}>
        {formatQuantity(ordered)} {item.unit || ''} × {formatCurrency(item.unit_price)}
        {item.brand ? ` · ${item.brand}` : ''}
      </Text>
      {ordered > 0 ? (
        <Text style={[styles.itemMeta, received >= ordered && { color: COLORS.success }]}>
          المستلم {formatQuantity(received)} من {formatQuantity(ordered)}
        </Text>
      ) : null}
    </View>
  );
}

export default function PurchaseOrderDetailScreen() {
  const { id } = useLocalSearchParams();
  const fetchOrder = useCallback(async () => {
    const [detail, payments] = await Promise.all([
      purchaseOrdersAPI.get(id),
      // Payments are secondary: show the order even if this call fails.
      purchaseOrdersAPI.payments(id).catch(() => null),
    ]);
    return { order: detail.data, payments: payments?.data || null };
  }, [id]);
  const { data, loading, refreshing, error, refresh } = useApiData(fetchOrder, 'خطأ في تحميل أمر الشراء');

  const order = data?.order;
  const paymentSummary = data?.payments?.payment_summary;
  const payments = data?.payments?.payments || [];
  const receipts = order?.receipt_summary;
  const items = order?.items || [];
  const trace = (order?.source_trace || []).filter((step) => step.type !== 'purchase_order' && step.number);

  const poTotal = Number(paymentSummary?.po_total ?? order?.final_total ?? 0);
  const paid = Number(paymentSummary?.paid_amount || 0);
  const remaining = Number(paymentSummary?.outstanding_amount ?? Math.max(0, poTotal - paid));

  const openTrace = (step) => {
    if (step.type === 'request' && step.id) router.push(`/requests/${step.id}`);
    if (step.type === 'comparison' && step.id) router.push(`/comparisons/${step.id}`);
  };
  const TRACE_LABELS = { request: 'طلب الشراء', comparison: 'مقارنة الأسعار', approval: 'الاعتماد' };

  return (
    <Screen title={order?.po_number || 'أمر شراء'} subtitle="تفاصيل أمر الشراء" back>
      {loading ? (
        <SkeletonLoader variant="detail" count={4} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={COLORS.text} />}
        >
          <ErrorBanner message={error} onRetry={refresh} />
          {order ? (
            <>
              <View style={styles.badges}>
                <StatusBadge kind="po" value={order.status} />
                {paymentSummary?.payment_status ? (
                  <StatusBadge kind="payment" value={paymentSummary.payment_status} />
                ) : null}
                {paymentSummary?.is_overdue ? <StatusBadge label="متأخر السداد" tone="danger" /> : null}
              </View>

              <Card>
                <InfoRow label="المورد" value={order.supplier_name} />
                <InfoRow label="المشروع" value={order.project_name} />
                <InfoRow label="العميل" value={order.customer_name} />
                <InfoRow label="تاريخ الأمر" value={formatDate(order.po_date)} />
                <InfoRow label="شروط الدفع" value={order.payment_terms} />
                <InfoRow
                  label="مدة التوريد"
                  value={order.delivery_days ? `${formatCount(order.delivery_days)} يوم` : ''}
                  last={!trace.length}
                />
                {trace.map((step, index) => (
                  <InfoRow
                    key={step.type}
                    label={TRACE_LABELS[step.type] || step.type}
                    value={step.number}
                    onPressValue={step.type !== 'approval' && step.id ? () => openTrace(step) : undefined}
                    last={index === trace.length - 1}
                  />
                ))}
              </Card>

              <SectionTitle title="المدفوعات" />
              <Card>
                <View style={styles.moneyTop}>
                  <View style={styles.moneyCol}>
                    <Text style={styles.moneyLabel}>إجمالي الأمر</Text>
                    <Text style={styles.moneyValue}>{formatCurrency(poTotal)}</Text>
                  </View>
                  <View style={styles.moneyCol}>
                    <Text style={styles.moneyLabel}>المدفوع</Text>
                    <Text style={[styles.moneyValue, { color: COLORS.success }]}>{formatCurrency(paid)}</Text>
                  </View>
                  <View style={styles.moneyCol}>
                    <Text style={styles.moneyLabel}>المتبقي</Text>
                    <Text style={[styles.moneyValue, { color: remaining > 0 ? COLORS.warning : COLORS.text }]}>
                      {formatCurrency(remaining)}
                    </Text>
                  </View>
                </View>
                <ProgressBar
                  value={paid}
                  total={poTotal}
                  startCaption={formatPercent(poTotal > 0 ? (paid / poTotal) * 100 : 0)}
                  endCaption={paymentSummary?.due_date ? `الاستحقاق ${formatDate(paymentSummary.due_date)}` : ''}
                />
                {!data?.payments ? <Text style={styles.note}>تعذر تحميل بيانات المدفوعات</Text> : null}
                {payments.map((payment) => {
                  const [label, tone] = PAYMENT_ROW_LABELS[payment.status] || [payment.status, 'neutral'];
                  return (
                    <View key={payment.id} style={styles.payment}>
                      <View style={styles.itemTop}>
                        <Text style={styles.paymentAmount}>{formatCurrency(payment.amount)}</Text>
                        <StatusBadge label={label} tone={tone} small />
                      </View>
                      <Text style={styles.itemMeta}>
                        {[formatDate(payment.payment_date), payment.payment_method, payment.payment_reference]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                      {payment.void_reason ? <Text style={styles.receiptNote}>{payment.void_reason}</Text> : null}
                    </View>
                  );
                })}
              </Card>

              <SectionTitle title="التوريد" />
              <Card>
                {receipts ? (
                  <>
                    <ProgressBar
                      value={receipts.received_quantity}
                      total={receipts.ordered_quantity}
                      color={COLORS.accent}
                      startCaption={`المستلم ${formatQuantity(receipts.received_quantity)} من ${formatQuantity(receipts.ordered_quantity)}`}
                      endCaption={`${formatCount(receipts.receipt_count)} استلام`}
                    />
                    <InfoRow
                      label="آخر استلام"
                      value={receipts.latest_receipt_date ? formatDateTime(receipts.latest_receipt_date) : 'لم يتم الاستلام بعد'}
                      last={!order.receipt_history?.length}
                    />
                  </>
                ) : null}
                {(order.receipt_history || []).map((receipt, index, all) => (
                  <View key={receipt.id} style={[styles.receipt, index === all.length - 1 && styles.itemLast]}>
                    <View style={styles.itemTop}>
                      <Text style={styles.receiptType}>
                        {RECEIPT_TYPE_LABELS[receipt.receipt_type] || receipt.receipt_type}
                      </Text>
                      <Text style={styles.itemMeta}>{formatDateTime(receipt.received_at)}</Text>
                    </View>
                    {receipt.actor_name ? <Text style={styles.itemMeta}>{receipt.actor_name}</Text> : null}
                    {receipt.problem_reason || receipt.note ? (
                      <Text style={styles.receiptNote}>{receipt.problem_reason || receipt.note}</Text>
                    ) : null}
                  </View>
                ))}
              </Card>

              <SectionTitle title="البنود" hint={formatCount(items.length)} />
              <Card>
                {items.map((item, index) => (
                  <ItemRow key={item.id} item={item} last={index === items.length - 1} />
                ))}
                <View style={styles.totals}>
                  <InfoRow label="الإجمالي قبل الخصم" value={formatCurrency(order.subtotal)} />
                  {Number(order.discount_total) ? (
                    <InfoRow label="الخصم" value={`- ${formatCurrency(order.discount_total)}`} />
                  ) : null}
                  {Number(order.vat_total) ? <InfoRow label="الضريبة" value={formatCurrency(order.vat_total)} /> : null}
                  {Number(order.shipping_total) ? (
                    <InfoRow label="الشحن" value={formatCurrency(order.shipping_total)} />
                  ) : null}
                  {Number(order.other_total) ? (
                    <InfoRow label="تكاليف أخرى" value={formatCurrency(order.other_total)} />
                  ) : null}
                  <InfoRow label="الإجمالي النهائي" value={formatCurrency(order.final_total)} last />
                </View>
              </Card>

              {order.notes ? (
                <>
                  <SectionTitle title="ملاحظات" />
                  <Card>
                    <Text style={styles.paragraph}>{order.notes}</Text>
                  </Card>
                </>
              ) : null}

              {/* PHASE 2: PO actions (record receipt / payment) go here. */}
              <ActionsPlaceholder />
            </>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.xl },
  badges: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.sm + SPACING.xs },
  paragraph: { color: COLORS.textSecondary, textAlign: 'right', lineHeight: 22 },
  note: { color: COLORS.warning, fontSize: FONT.sm, textAlign: 'right', marginTop: SPACING.sm },
  moneyTop: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: SPACING.sm + SPACING.xs },
  moneyCol: { alignItems: 'flex-end' },
  moneyLabel: { color: COLORS.muted, fontSize: FONT.sm },
  moneyValue: { color: COLORS.text, fontWeight: '700', fontSize: FONT.md, marginTop: SPACING.xxs },
  payment: {
    paddingTop: SPACING.sm + 2,
    marginTop: SPACING.sm + 2,
    borderTopColor: COLORS.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  paymentAmount: { color: COLORS.text, fontWeight: '700' },
  receipt: {
    paddingVertical: SPACING.sm + 2,
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  receiptType: { color: COLORS.text, fontWeight: '600' },
  receiptNote: { color: COLORS.warning, fontSize: FONT.sm + 1, textAlign: 'right', marginTop: SPACING.xxs },
  item: {
    paddingVertical: SPACING.sm + 2,
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemLast: { borderBottomWidth: 0 },
  itemTop: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', gap: SPACING.sm },
  itemName: { flex: 1, color: COLORS.text, fontWeight: '600', textAlign: 'right' },
  itemTotal: { color: COLORS.text, fontWeight: '700' },
  itemMeta: { color: COLORS.muted, fontSize: FONT.sm, textAlign: 'right', marginTop: SPACING.xxs },
  totals: { marginTop: SPACING.sm, borderTopColor: COLORS.border, borderTopWidth: 1 },
});
