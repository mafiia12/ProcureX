import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import ErrorBanner from '../../components/ErrorBanner';
import KPICard from '../../components/KPICard';
import LoadingSpinner from '../../components/LoadingSpinner';
import Screen from '../../components/Screen';
import { COLORS } from '../../constants/colors';
import { dashboardAPI } from '../../services/api';
import { errorMessage, formatCount, formatMoney } from '../../utils/formatters';

// Field names come from GET /api/dashboard (server.py + calculate_procurement_kpis).
const KPIS = [
  { key: 'request_count', label: 'طلبات الشراء', icon: 'inbox', format: formatCount },
  { key: 'comparison_count', label: 'مقارنات الأسعار', icon: 'compare-horizontal', format: formatCount },
  { key: 'formal_po_count', label: 'أوامر الشراء', icon: 'file-document', format: formatCount },
  { key: 'formal_po_total', label: 'قيمة أوامر الشراء', icon: 'cash-multiple', format: formatMoney },
  { key: 'formal_under_supply_count', label: 'تحت التوريد', icon: 'truck-delivery', format: formatCount, color: COLORS.warning },
  { key: 'approval_pending_count', label: 'دفعات بانتظار المراجعة', icon: 'timer-sand', format: formatCount, color: COLORS.warning },
  { key: 'total_paid', label: 'إجمالي المدفوع', icon: 'check-circle', format: formatMoney, color: COLORS.success },
  { key: 'total_outstanding', label: 'المتبقي للموردين', icon: 'alert-circle', format: formatMoney, color: COLORS.danger },
];

export default function DashboardScreen() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await dashboardAPI.get();
      setData(response.data);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'خطأ في تحميل لوحة التحكم'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingSpinner />;

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  return (
    <Screen title="لوحة التحكم">
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.text} />}
      >
        <ErrorBanner message={error} onRetry={onRefresh} />
        {data ? (
          <>
            <View style={styles.grid}>
              {KPIS.map((kpi) => (
                <KPICard
                  key={kpi.key}
                  icon={kpi.icon}
                  label={kpi.label}
                  color={kpi.color}
                  value={kpi.format(data[kpi.key])}
                />
              ))}
            </View>

            {data.by_supplier?.length ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>أعلى الموردين (مشتريات مباشرة)</Text>
                {data.by_supplier.slice(0, 5).map((row) => (
                  <View key={row.name} style={styles.row}>
                    <Text style={styles.rowName} numberOfLines={1}>{row.name || '—'}</Text>
                    <Text style={styles.rowValue}>{formatMoney(row.total)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', justifyContent: 'space-between' },
  section: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  sectionTitle: { color: COLORS.text, fontWeight: '700', fontSize: 16, marginBottom: 8, textAlign: 'right' },
  row: { flexDirection: 'row-reverse', justifyContent: 'space-between', paddingVertical: 6 },
  rowName: { color: COLORS.textSecondary, flex: 1, textAlign: 'right', marginLeft: 12 },
  rowValue: { color: COLORS.text, fontWeight: '600' },
});
