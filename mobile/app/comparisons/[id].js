import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import ActionsPlaceholder from '../../components/ActionsPlaceholder';
import Card from '../../components/Card';
import ErrorBanner from '../../components/ErrorBanner';
import InfoRow from '../../components/InfoRow';
import Screen from '../../components/Screen';
import SectionTitle from '../../components/SectionTitle';
import SkeletonLoader from '../../components/SkeletonLoader';
import StatusBadge from '../../components/StatusBadge';
import { COLORS, FONT, RADIUS, SPACING, TONES } from '../../constants/theme';
import useApiData from '../../hooks/useApiData';
import { comparisonsAPI } from '../../services/api';
import {
  formatCount,
  formatCurrency,
  formatDate,
  formatPercent,
  formatQuantity,
} from '../../utils/formatters';

// Shape: GET /api/price-comparisons/{id} → price_comparisons._detail +
// calculate_comparison (rows, product_summaries, supplier_summaries,
// scenario_summary).
//
// Backend semantics worth knowing when reading this screen:
// - row.eligible = available AND priced AND not expired AND complete data.
// - row.is_lowest_final_total is computed among ELIGIBLE rows only.
// - supplier.is_complete = the supplier has an eligible offer for EVERY item.
// So the per-item "lowest" can belong to a supplier that is incomplete
// overall, and an ineligible offer can be cheaper than the highlighted one.
// Both cases are flagged explicitly below.

const supplierKey = (row) => String(row.supplier_id || row.supplier_code || row.supplier_name || '');
const itemKey = (row) => String(row.item_id || row.item_code || '');

function rowProblems(row) {
  const problems = [];
  if (row.is_unavailable) problems.push('غير متوفر');
  if (row.is_missing_price) problems.push('بدون سعر');
  if (row.is_expired) problems.push('عرض منتهي');
  if (row.is_incomplete && !row.is_missing_price) problems.push('بيانات ناقصة');
  return problems;
}

function deliveryText(days) {
  const n = Number(days);
  return n > 0 ? `${formatCount(n)} يوم` : '—';
}

function ScenarioCard({ scenario, suppliers }) {
  const cheapest = scenario?.cheapest_complete_supplier;
  const savings = Number(scenario?.savings_amount || 0);
  const mixedCount = Number(scenario?.mixed_supplier_count || 0);
  const incompleteCount = suppliers.filter((s) => !s.is_complete).length;

  return (
    <Card>
      <Text style={styles.scenarioHeading}>ملخص القرار</Text>
      <View style={styles.scenarioRow}>
        <View style={styles.scenarioCol}>
          <Text style={styles.scenarioLabel}>أرخص مورد واحد (عرض مكتمل)</Text>
          {cheapest ? (
            <>
              <Text style={styles.scenarioValue}>{formatCurrency(cheapest.final_offer_total)}</Text>
              <Text style={styles.scenarioSub} numberOfLines={1}>
                {cheapest.supplier_name}
              </Text>
            </>
          ) : (
            <Text style={[styles.scenarioSub, { color: COLORS.warning }]}>لا يوجد مورد بعرض مكتمل</Text>
          )}
        </View>
        <View style={styles.scenarioDivider} />
        <View style={styles.scenarioCol}>
          <Text style={styles.scenarioLabel}>الشراء المختلط (الأقل لكل بند)</Text>
          <Text style={styles.scenarioValue}>{formatCurrency(scenario?.mixed_supplier_total)}</Text>
          <Text style={styles.scenarioSub}>من {formatCount(mixedCount)} مورد</Text>
        </View>
      </View>

      <View
        style={[
          styles.savings,
          { backgroundColor: savings > 0 ? TONES.success.bg : TONES.neutral.bg },
        ]}
      >
        {scenario?.savings_amount === null || scenario?.savings_amount === undefined ? (
          <Text style={styles.savingsText}>لا يمكن حساب التوفير بدون عرض مكتمل من مورد واحد</Text>
        ) : savings > 0 ? (
          <Text style={[styles.savingsText, { color: COLORS.success }]}>
            توفير الشراء المختلط: {formatCurrency(savings)} ({formatPercent(scenario.savings_pct)})
          </Text>
        ) : (
          <Text style={styles.savingsText}>لا يوجد توفير من تقسيم الشراء — المورد الواحد هو الأفضل</Text>
        )}
      </View>

      {incompleteCount ? (
        <View style={styles.warnLine}>
          <MaterialCommunityIcons name="alert" size={16} color={COLORS.warning} />
          <Text style={styles.warnText}>
            {formatCount(incompleteCount)} من الموردين عروضهم غير مكتملة — أسعارهم المنخفضة لا تعني أنها الأفضل
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

function SupplierCard({ supplier, isCheapestComplete }) {
  return (
    <Card tone={supplier.is_complete ? (isCheapestComplete ? COLORS.success : undefined) : COLORS.warning}>
      <View style={styles.supTop}>
        <Text style={styles.supName} numberOfLines={1}>
          {supplier.supplier_name || '—'}
        </Text>
        <Text style={styles.supTotal}>{formatCurrency(supplier.final_offer_total)}</Text>
      </View>
      <View style={styles.supBadges}>
        {supplier.is_complete ? (
          <StatusBadge label="عرض مكتمل" tone="success" small />
        ) : (
          <StatusBadge label="عرض غير مكتمل" tone="warning" small />
        )}
        {isCheapestComplete ? <StatusBadge label="الأرخص بين المكتملين" tone="success" small /> : null}
      </View>
      <View style={styles.supStats}>
        <Text style={styles.supStat}>التوفر {formatPercent(supplier.availability_pct)}</Text>
        <Text style={styles.supStat}>التوريد {deliveryText(supplier.maximum_delivery_days)}</Text>
        <Text style={styles.supStat}>
          بنود مسعرة {formatCount(supplier.products_quoted)}
          {supplier.unavailable_products ? ` · غير متوفر ${formatCount(supplier.unavailable_products)}` : ''}
        </Text>
      </View>
      {supplier.is_complete && Number(supplier.difference_from_lowest_complete) > 0 ? (
        <Text style={styles.supDiff}>
          أعلى من الأرخص بـ {formatCurrency(supplier.difference_from_lowest_complete)}
        </Text>
      ) : null}
    </Card>
  );
}

function OfferRow({ row, supplierComplete, last }) {
  const problems = rowProblems(row);
  const lowest = row.is_lowest_final_total;
  return (
    <View
      style={[
        styles.offer,
        lowest && styles.offerLowest,
        !row.eligible && styles.offerIneligible,
        last && styles.offerLast,
      ]}
    >
      <View style={styles.offerTop}>
        <Text style={styles.offerSupplier} numberOfLines={1}>
          {row.supplier_name || '—'}
        </Text>
        <Text style={[styles.offerPrice, lowest && { color: COLORS.success }]}>
          {row.is_missing_price ? '—' : formatCurrency(row.unit_price)}
        </Text>
      </View>
      <View style={styles.offerMeta}>
        <Text style={styles.offerMetaText}>
          الإجمالي {row.is_missing_price ? '—' : formatCurrency(row.final_total)} · التوريد{' '}
          {deliveryText(row.delivery_days)}
        </Text>
      </View>
      <View style={styles.offerBadges}>
        {lowest ? <StatusBadge label="الأقل سعرًا" tone="success" small /> : null}
        {row.is_fastest_delivery ? <StatusBadge label="الأسرع توريدًا" tone="info" small /> : null}
        {problems.map((problem) => (
          <StatusBadge key={problem} label={problem} tone="danger" small />
        ))}
        {!supplierComplete ? <StatusBadge label="مورد بعرض غير مكتمل" tone="warning" small /> : null}
      </View>
    </View>
  );
}

function ItemCard({ summary, rows, supplierCompleteByKey }) {
  const first = rows[0] || {};
  // Eligible rows first by price; ineligible (and unpriced) rows after.
  const sorted = [...rows].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    const pa = a.is_missing_price ? Infinity : Number(a.unit_price);
    const pb = b.is_missing_price ? Infinity : Number(b.unit_price);
    return pa - pb;
  });
  const lowestEligible = summary.lowest_unit_price;
  const cheaperIneligible = rows.find(
    (row) =>
      !row.eligible &&
      !row.is_missing_price &&
      (lowestEligible === null || lowestEligible === undefined || Number(row.unit_price) < Number(lowestEligible))
  );
  const lowestRow = rows.find((row) => row.is_lowest_final_total);
  const lowestFromIncomplete = lowestRow && !supplierCompleteByKey[supplierKey(lowestRow)];

  return (
    <Card>
      <View style={styles.itemHead}>
        <Text style={styles.itemName}>{summary.product_name || first.product_name || '—'}</Text>
        <Text style={styles.itemQty}>
          {formatQuantity(first.quantity)} {first.unit || ''}
        </Text>
      </View>
      {summary.brand ? <Text style={styles.itemBrand}>{summary.brand}</Text> : null}

      {lowestEligible === null || lowestEligible === undefined ? (
        <Text style={styles.itemWarn}>لا يوجد عرض مؤهل لهذا البند</Text>
      ) : null}
      {cheaperIneligible ? (
        <Text style={styles.itemWarn}>
          يوجد سعر أقل ({formatCurrency(cheaperIneligible.unit_price)} من {cheaperIneligible.supplier_name}) لكنه غير
          مؤهل: {rowProblems(cheaperIneligible).join('، ') || 'غير مؤهل'}
        </Text>
      ) : null}
      {lowestFromIncomplete ? (
        <Text style={styles.itemWarn}>الأقل سعرًا هنا من مورد لم يقدّم عرضًا مكتملًا لكل البنود</Text>
      ) : null}

      <View style={styles.offers}>
        {sorted.map((row, index) => (
          <OfferRow
            key={row.id || `${supplierKey(row)}-${index}`}
            row={row}
            supplierComplete={supplierCompleteByKey[supplierKey(row)] !== false}
            last={index === sorted.length - 1}
          />
        ))}
      </View>
      {summary.last_historical_unit_price !== null && summary.last_historical_unit_price !== undefined ? (
        <Text style={styles.itemHistory}>آخر سعر شراء: {formatCurrency(summary.last_historical_unit_price)}</Text>
      ) : null}
    </Card>
  );
}

export default function ComparisonDetailScreen() {
  const { id } = useLocalSearchParams();
  const fetchComparison = useCallback(async () => (await comparisonsAPI.get(id)).data, [id]);
  const { data, loading, refreshing, error, refresh } = useApiData(fetchComparison, 'خطأ في تحميل المقارنة');

  const view = useMemo(() => {
    if (!data) return null;
    const suppliers = [...(data.supplier_summaries || [])].sort((a, b) => {
      if (a.is_complete !== b.is_complete) return a.is_complete ? -1 : 1;
      return Number(a.final_offer_total || 0) - Number(b.final_offer_total || 0);
    });
    const supplierCompleteByKey = {};
    suppliers.forEach((s) => {
      supplierCompleteByKey[supplierKey(s)] = !!s.is_complete;
    });
    const rowsByItem = {};
    (data.rows || []).forEach((row) => {
      (rowsByItem[itemKey(row)] ||= []).push(row);
    });
    const cheapest = data.scenario_summary?.cheapest_complete_supplier;
    return {
      suppliers,
      supplierCompleteByKey,
      rowsByItem,
      cheapestKey: cheapest ? supplierKey(cheapest) : null,
      products: data.product_summaries || [],
    };
  }, [data]);

  return (
    <Screen title={data?.comparison_number || 'مقارنة أسعار'} subtitle="تفاصيل مقارنة الأسعار" back>
      {loading ? (
        <SkeletonLoader variant="detail" count={4} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={COLORS.text} />}
        >
          <ErrorBanner message={error} onRetry={refresh} />
          {data && view ? (
            <>
              <ScenarioCard scenario={data.scenario_summary} suppliers={view.suppliers} />

              <Card>
                <InfoRow label="المشروع" value={data.project_name} />
                <InfoRow label="العميل" value={data.customer_name} />
                <InfoRow label="تاريخ المقارنة" value={formatDate(data.comparison_date)} />
                <InfoRow
                  label="طلب الشراء المصدر"
                  value={data.source_request_number}
                  onPressValue={
                    data.source_request_id ? () => router.push(`/requests/${data.source_request_id}`) : undefined
                  }
                  last
                />
              </Card>

              <SectionTitle title="الموردون" hint={formatCount(view.suppliers.length)} />
              {view.suppliers.length ? (
                view.suppliers.map((supplier) => (
                  <SupplierCard
                    key={supplierKey(supplier)}
                    supplier={supplier}
                    isCheapestComplete={supplierKey(supplier) === view.cheapestKey}
                  />
                ))
              ) : (
                <Text style={styles.empty}>لا توجد عروض موردين</Text>
              )}

              <SectionTitle title="الأسعار حسب البند" hint={formatCount(view.products.length)} />
              <View style={styles.legend}>
                <StatusBadge label="الأقل سعرًا" tone="success" small />
                <Text style={styles.legendText}>= أقل سعر بين العروض المؤهلة فقط</Text>
              </View>
              {view.products.map((summary) => (
                <ItemCard
                  key={itemKey(summary)}
                  summary={summary}
                  rows={view.rowsByItem[itemKey(summary)] || []}
                  supplierCompleteByKey={view.supplierCompleteByKey}
                />
              ))}

              {data.notes ? (
                <>
                  <SectionTitle title="ملاحظات" />
                  <Card>
                    <Text style={styles.paragraph}>{data.notes}</Text>
                  </Card>
                </>
              ) : null}

              {/* PHASE 2: comparison actions (select supplier / send for approval) go here. */}
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
  empty: { color: COLORS.muted, textAlign: 'center', paddingVertical: SPACING.sm },
  paragraph: { color: COLORS.textSecondary, textAlign: 'right', lineHeight: 22 },

  scenarioHeading: { color: COLORS.text, fontWeight: '700', fontSize: FONT.lg, textAlign: 'right' },
  scenarioRow: { flexDirection: 'row-reverse', marginTop: SPACING.sm + SPACING.xs },
  scenarioCol: { flex: 1, alignItems: 'flex-end' },
  scenarioDivider: { width: StyleSheet.hairlineWidth, backgroundColor: COLORS.border, marginHorizontal: SPACING.sm },
  scenarioLabel: { color: COLORS.muted, fontSize: FONT.sm, textAlign: 'right' },
  scenarioValue: { color: COLORS.text, fontSize: FONT.xl, fontWeight: '800', marginTop: SPACING.xs },
  scenarioSub: { color: COLORS.textSecondary, fontSize: FONT.sm + 1, marginTop: SPACING.xxs, textAlign: 'right' },
  savings: { borderRadius: RADIUS.sm, padding: SPACING.sm + 2, marginTop: SPACING.sm + SPACING.xs },
  savingsText: { color: COLORS.textSecondary, fontWeight: '600', textAlign: 'right' },
  warnLine: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: SPACING.xs + 2, marginTop: SPACING.sm + 2 },
  warnText: { flex: 1, color: COLORS.warning, fontSize: FONT.sm + 1, textAlign: 'right' },

  supTop: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', gap: SPACING.sm },
  supName: { flex: 1, color: COLORS.text, fontWeight: '700', fontSize: FONT.md, textAlign: 'right' },
  supTotal: { color: COLORS.text, fontWeight: '800', fontSize: FONT.lg },
  supBadges: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: SPACING.xs + 2, marginTop: SPACING.sm },
  supStats: { flexDirection: 'row-reverse', flexWrap: 'wrap', columnGap: SPACING.md, rowGap: SPACING.xxs, marginTop: SPACING.sm },
  supStat: { color: COLORS.textSecondary, fontSize: FONT.sm + 1 },
  supDiff: { color: COLORS.muted, fontSize: FONT.sm, textAlign: 'right', marginTop: SPACING.xs },

  legend: { flexDirection: 'row-reverse', alignItems: 'center', gap: SPACING.xs + 2, marginBottom: SPACING.sm },
  legendText: { color: COLORS.muted, fontSize: FONT.sm },
  itemHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', gap: SPACING.sm },
  itemName: { flex: 1, color: COLORS.text, fontWeight: '700', fontSize: FONT.md, textAlign: 'right' },
  itemQty: { color: COLORS.textSecondary, fontWeight: '600' },
  itemBrand: { color: COLORS.muted, fontSize: FONT.sm, textAlign: 'right', marginTop: SPACING.xxs },
  itemWarn: { color: COLORS.warning, fontSize: FONT.sm + 1, textAlign: 'right', marginTop: SPACING.xs + 2 },
  itemHistory: { color: COLORS.muted, fontSize: FONT.sm, textAlign: 'right', marginTop: SPACING.sm },
  offers: { marginTop: SPACING.sm },
  offer: {
    borderRadius: RADIUS.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  offerLast: { borderBottomWidth: 0 },
  offerLowest: { backgroundColor: TONES.success.bg, borderBottomWidth: 0, marginBottom: SPACING.xxs },
  offerIneligible: { opacity: 0.6 },
  offerTop: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', gap: SPACING.sm },
  offerSupplier: { flex: 1, color: COLORS.text, fontWeight: '600', textAlign: 'right' },
  offerPrice: { color: COLORS.text, fontWeight: '700', fontSize: FONT.md },
  offerMeta: { marginTop: SPACING.xxs },
  offerMetaText: { color: COLORS.muted, fontSize: FONT.sm, textAlign: 'right' },
  offerBadges: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.xs + 2 },
});
