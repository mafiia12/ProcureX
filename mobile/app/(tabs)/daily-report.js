import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import ErrorBanner from '../../components/ErrorBanner';
import LoadingSpinner from '../../components/LoadingSpinner';
import Screen from '../../components/Screen';
import { COLORS } from '../../constants/colors';
import { reportAPI } from '../../services/api';
import { errorMessage, formatCount, formatMoney, shiftIsoDate, toIsoDate } from '../../utils/formatters';

// Field names come from GET /api/reports/daily → summary (daily_report.py).
const SUMMARY_ROWS = [
  { key: 'new_requests_count', label: 'طلبات جديدة', format: formatCount },
  { key: 'rfqs_created_count', label: 'طلبات عروض أسعار', format: formatCount },
  { key: 'comparisons_active_count', label: 'مقارنات نشطة', format: formatCount },
  { key: 'approvals_completed_count', label: 'اعتمادات مكتملة', format: formatCount },
  { key: 'purchase_orders_issued_count', label: 'أوامر شراء صادرة', format: formatCount },
  { key: 'purchase_orders_issued_value', label: 'قيمة أوامر الشراء', format: formatMoney },
  { key: 'payments_made_count', label: 'دفعات اليوم', format: formatCount },
  { key: 'payments_made_value', label: 'قيمة الدفعات', format: formatMoney },
  { key: 'receipts_recorded_count', label: 'استلامات مسجلة', format: formatCount },
  { key: 'outstanding_supplier_balance', label: 'رصيد الموردين المتبقي', format: formatMoney },
];

export default function DailyReportScreen() {
  const [date, setDate] = useState(() => toIsoDate(new Date()));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await reportAPI.getDailyReport(date);
      setReport(response.data);
      setError('');
    } catch (err) {
      setReport(null);
      setError(errorMessage(err, 'خطأ في تحميل التقرير اليومي'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const isToday = date === toIsoDate(new Date());
  const notes = report?.notes || {};

  return (
    <Screen title="التقرير اليومي">
      <View style={styles.dateBar}>
        <Pressable onPress={() => setDate((d) => shiftIsoDate(d, -1))} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-right" size={28} color={COLORS.text} />
        </Pressable>
        <Text style={styles.date}>{date}</Text>
        <Pressable onPress={() => setDate((d) => shiftIsoDate(d, 1))} disabled={isToday} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={isToday ? COLORS.border : COLORS.text} />
        </Pressable>
      </View>

      {loading ? (
        <LoadingSpinner />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={COLORS.text}
            />
          }
        >
          <ErrorBanner message={error} onRetry={load} />
          {report ? (
            <>
              <View style={styles.metaRow}>
                <Text style={styles.meta}>{report.report_number}</Text>
                <Text style={[styles.badge, report.is_closed ? styles.closed : styles.open]}>
                  {report.is_closed ? 'مغلق' : 'مفتوح'}
                </Text>
              </View>
              <View style={styles.card}>
                {SUMMARY_ROWS.map((row) => (
                  <View key={row.key} style={styles.row}>
                    <Text style={styles.label}>{row.label}</Text>
                    <Text style={styles.value}>{row.format(report.summary?.[row.key])}</Text>
                  </View>
                ))}
              </View>
              {[
                ['general_notes', 'ملاحظات عامة'],
                ['key_risks', 'المخاطر الرئيسية'],
                ['follow_up_notes', 'متابعات'],
              ].map(([key, label]) =>
                notes[key] ? (
                  <View key={key} style={styles.card}>
                    <Text style={styles.noteTitle}>{label}</Text>
                    <Text style={styles.noteText}>{notes[key]}</Text>
                  </View>
                ) : null
              )}
            </>
          ) : null}
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
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: COLORS.card,
    borderRadius: 8,
  },
  date: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  metaRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  meta: { color: COLORS.textSecondary },
  badge: { paddingHorizontal: 10, paddingVertical: 2, borderRadius: 10, overflow: 'hidden', fontSize: 12, color: COLORS.text },
  open: { backgroundColor: COLORS.success },
  closed: { backgroundColor: COLORS.border },
  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { color: COLORS.textSecondary },
  value: { color: COLORS.text, fontWeight: '600' },
  noteTitle: { color: COLORS.text, fontWeight: '700', marginBottom: 6, textAlign: 'right' },
  noteText: { color: COLORS.textSecondary, textAlign: 'right', lineHeight: 20 },
});
