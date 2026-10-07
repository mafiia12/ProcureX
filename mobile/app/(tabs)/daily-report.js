import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import Card from '../../components/Card';
import EmptyState from '../../components/EmptyState';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import SectionTitle from '../../components/SectionTitle';
import SkeletonLoader from '../../components/SkeletonLoader';
import StatusBadge from '../../components/StatusBadge';
import { COLORS, FONT, RADIUS, SPACING } from '../../constants/theme';
import useApiData from '../../hooks/useApiData';
import { reportAPI } from '../../services/api';
import {
  formatCount,
  formatCurrency,
  formatLongDate,
  shiftIsoDate,
  toIsoDate,
} from '../../utils/formatters';

// Field names come from GET /api/reports/daily → summary (daily_report.py).
const ACTIVITY_ROWS = [
  { key: 'new_requests_count', label: 'طلبات جديدة', icon: 'inbox' },
  { key: 'rfqs_created_count', label: 'طلبات عروض أسعار', icon: 'email-fast-outline' },
  { key: 'comparisons_active_count', label: 'مقارنات نشطة', icon: 'compare-horizontal' },
  { key: 'approvals_completed_count', label: 'اعتمادات مكتملة', icon: 'check-decagram' },
  { key: 'purchase_orders_issued_count', label: 'أوامر شراء صادرة', icon: 'file-document' },
  { key: 'payments_made_count', label: 'دفعات اليوم', icon: 'cash' },
  { key: 'receipts_recorded_count', label: 'استلامات مسجلة', icon: 'truck-check' },
];
const MONEY_ROWS = [
  { key: 'purchase_orders_issued_value', label: 'قيمة أوامر الشراء الصادرة' },
  { key: 'payments_made_value', label: 'قيمة الدفعات' },
  { key: 'outstanding_supplier_balance', label: 'رصيد الموردين المتبقي' },
];
const NOTE_SECTIONS = [
  ['general_notes', 'ملاحظات عامة'],
  ['key_risks', 'المخاطر الرئيسية'],
  ['follow_up_notes', 'متابعات'],
];

// Zero rows stay visible (so the report shape is stable) but dimmed.
function MetricRow({ icon, label, value, isZero, last }) {
  return (
    <View style={[styles.metric, isZero && styles.dim, last && styles.lastRow]}>
      {icon ? <MaterialCommunityIcons name={icon} size={18} color={COLORS.textSecondary} /> : null}
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export default function DailyReportScreen() {
  const today = toIsoDate(new Date());
  const [date, setDate] = useState(today);
  const fetchReport = useCallback(async () => (await reportAPI.getDailyReport(date)).data, [date]);
  const { data: report, loading, refreshing, error, refresh } = useApiData(
    fetchReport,
    'خطأ في تحميل التقرير اليومي'
  );

  const isToday = date === today;
  const summary = report?.summary || {};
  const notes = report?.notes || {};
  const requests = report?.sections?.requests_received || [];
  const orders = report?.sections?.purchase_orders_issued || [];
  const activityTotal = ACTIVITY_ROWS.reduce((sum, row) => sum + Number(summary[row.key] || 0), 0);

  return (
    <Screen title="التقرير اليومي">
      <View style={styles.dateBar}>
        <Pressable onPress={() => setDate((d) => shiftIsoDate(d, -1))} hitSlop={12} accessibilityLabel="اليوم السابق">
          <MaterialCommunityIcons name="chevron-right" size={28} color={COLORS.text} />
        </Pressable>
        <View style={styles.dateCenter}>
          <Text style={styles.date}>{formatLongDate(date)}</Text>
          {!isToday ? (
            <Pressable onPress={() => setDate(today)} hitSlop={8}>
              <Text style={styles.todayLink}>العودة لليوم</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => setDate((d) => shiftIsoDate(d, 1))}
          disabled={isToday}
          hitSlop={12}
          accessibilityLabel="اليوم التالي"
        >
          <MaterialCommunityIcons name="chevron-left" size={28} color={isToday ? COLORS.border : COLORS.text} />
        </Pressable>
      </View>

      {loading ? (
        <SkeletonLoader variant="detail" count={3} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={COLORS.text} />}
        >
          <ErrorBanner message={error} onRetry={refresh} />
          {report ? (
            <>
              <View style={styles.metaRow}>
                <Text style={styles.meta}>{report.report_number}</Text>
                <StatusBadge
                  label={report.is_closed ? 'مغلق' : 'مفتوح'}
                  tone={report.is_closed ? 'neutral' : 'success'}
                />
              </View>

              {activityTotal === 0 ? (
                <Text style={styles.quiet}>لا يوجد نشاط مسجل في هذا اليوم</Text>
              ) : null}

              <SectionTitle title="النشاط" />
              <Card>
                {ACTIVITY_ROWS.map((row, index) => (
                  <MetricRow
                    key={row.key}
                    icon={row.icon}
                    label={row.label}
                    value={formatCount(summary[row.key])}
                    isZero={!Number(summary[row.key])}
                    last={index === ACTIVITY_ROWS.length - 1}
                  />
                ))}
              </Card>

              <SectionTitle title="المبالغ" />
              <Card>
                {MONEY_ROWS.map((row, index) => (
                  <MetricRow
                    key={row.key}
                    label={row.label}
                    value={formatCurrency(summary[row.key] || 0)}
                    isZero={!Number(summary[row.key])}
                    last={index === MONEY_ROWS.length - 1}
                  />
                ))}
              </Card>

              {requests.length ? (
                <>
                  <SectionTitle title="الطلبات المستلمة" hint={formatCount(requests.length)} />
                  {requests.map((row) => (
                    <Card key={row.id} onPress={() => router.push(`/requests/${row.id}`)}>
                      <Text style={styles.itemTitle}>{row.request_number}</Text>
                      <Text style={styles.itemSub} numberOfLines={1}>
                        {[row.project_name, row.requester_name].filter(Boolean).join(' · ') || '—'}
                      </Text>
                      <Text style={styles.itemMeta}>{row.item_count} بند</Text>
                    </Card>
                  ))}
                </>
              ) : null}

              {orders.length ? (
                <>
                  <SectionTitle title="أوامر الشراء الصادرة" hint={formatCount(orders.length)} />
                  {orders.map((row) => (
                    <Card key={row.id} onPress={() => router.push(`/purchase-orders/${row.id}`)}>
                      <Text style={styles.itemTitle}>{row.po_number}</Text>
                      <Text style={styles.itemSub} numberOfLines={1}>
                        {[row.supplier_name, row.project_name].filter(Boolean).join(' · ') || '—'}
                      </Text>
                      <Text style={styles.itemMeta}>{row.item_count} بند</Text>
                    </Card>
                  ))}
                </>
              ) : null}

              {NOTE_SECTIONS.map(([key, label]) =>
                notes[key] ? (
                  <View key={key}>
                    <SectionTitle title={label} />
                    <Card>
                      <Text style={styles.noteText}>{notes[key]}</Text>
                    </Card>
                  </View>
                ) : null
              )}
            </>
          ) : error ? null : (
            <EmptyState icon="calendar-blank" title="لا يوجد تقرير لهذا اليوم" />
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  dateBar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
  },
  dateCenter: { alignItems: 'center' },
  date: { color: COLORS.text, fontSize: FONT.md, fontWeight: '600' },
  todayLink: { color: COLORS.accent, fontSize: FONT.sm, marginTop: SPACING.xxs },
  content: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.xl },
  metaRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  meta: { color: COLORS.textSecondary },
  quiet: { color: COLORS.muted, textAlign: 'center', marginTop: SPACING.md },
  metric: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm + 2,
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastRow: { borderBottomWidth: 0 },
  dim: { opacity: 0.4 },
  metricLabel: { flex: 1, color: COLORS.textSecondary, fontSize: FONT.body, textAlign: 'right' },
  metricValue: { color: COLORS.text, fontWeight: '700', fontSize: FONT.md },
  itemTitle: { color: COLORS.text, fontWeight: '700', textAlign: 'right' },
  itemSub: { color: COLORS.textSecondary, fontSize: FONT.sm + 1, textAlign: 'right', marginTop: SPACING.xxs },
  itemMeta: { color: COLORS.muted, fontSize: FONT.sm, textAlign: 'right', marginTop: SPACING.xxs },
  noteText: { color: COLORS.textSecondary, textAlign: 'right', lineHeight: 22 },
});
