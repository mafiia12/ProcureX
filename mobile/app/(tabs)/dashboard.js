import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import BarChart from '../../components/BarChart';
import Card from '../../components/Card';
import ErrorBanner from '../../components/ErrorBanner';
import KPICard from '../../components/KPICard';
import ProgressBar from '../../components/ProgressBar';
import SectionTitle from '../../components/SectionTitle';
import SkeletonLoader from '../../components/SkeletonLoader';
import { COLORS, FONT, RADIUS, SHADOW, SPACING } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import useApiData from '../../hooks/useApiData';
import { dashboardAPI } from '../../services/api';
import {
  formatCount,
  formatCurrency,
  formatLongDate,
  formatPercent,
  roleLabel,
  toIsoDate,
} from '../../utils/formatters';

// Field names come from GET /api/dashboard (server.py dashboard +
// calculate_procurement_kpis + _dashboard_procurement_intelligence).
const KPIS = [
  { key: 'request_count', label: 'طلبات الشراء', icon: 'inbox', href: '/requests' },
  { key: 'comparison_count', label: 'مقارنات الأسعار', icon: 'compare-horizontal', href: '/comparisons' },
  { key: 'formal_po_count', label: 'أوامر الشراء', icon: 'file-document', href: '/purchase-orders' },
  {
    key: 'formal_under_supply_count',
    label: 'تحت التوريد',
    icon: 'truck-delivery',
    color: COLORS.warning,
    href: '/purchase-orders',
  },
  {
    key: 'requests_requiring_action',
    from: 'summary',
    label: 'طلبات تحتاج إجراء',
    icon: 'alert-decagram',
    color: COLORS.danger,
    href: '/requests',
  },
  { key: 'approval_pending_count', label: 'دفعات بانتظار المراجعة', icon: 'timer-sand', color: COLORS.warning },
];

// Dashboard chart groups → the single status a list can filter on (groups
// spanning several statuses open the unfiltered list). Tab screens stay
// mounted, so `status` is always passed explicitly ('' = all) to clear any
// filter left over from a previous tap.
const PO_GROUP_STATUS = {
  under_delivery: 'in_delivery',
  partial_receipt: 'partial_received',
  delivery_problem: 'delivery_problem',
  completed: 'completed',
};
const PO_GROUP_COLORS = {
  awaiting_issue: COLORS.neutral,
  awaiting_supplier: COLORS.info,
  under_delivery: COLORS.warning,
  partial_receipt: COLORS.warning,
  delivery_problem: COLORS.danger,
  completed: COLORS.success,
};
const REQUEST_STAGE_STATUS = {
  new: 'new',
  pricing_rfq: 'pricing',
  waiting_approval: 'waiting_for_approval',
  po_procurement: 'approved',
  under_delivery: 'converted_to_purchase',
  completed: 'completed',
};

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'صباح الخير' : 'مساء الخير';
}

function openPath(path) {
  // attention_items carry web paths; only PO paths map 1:1 to a mobile screen.
  if (path?.startsWith('/purchase-orders/')) router.push(path);
  else if (path === '/incoming-requests') router.navigate({ pathname: '/requests', params: { status: '' } });
}

const fetchDashboard = async () => (await dashboardAPI.get()).data;

export default function DashboardScreen() {
  const { user } = useAuth();
  const { data, loading, refreshing, error, refresh } = useApiData(
    useCallback(fetchDashboard, []),
    'خطأ في تحميل لوحة التحكم'
  );

  const summary = data?.summary || {};
  const poValue = summary.formal_po_value ?? data?.formal_po_total ?? 0;
  const paid = summary.actual_paid ?? 0;
  const outstanding = summary.outstanding ?? 0;
  const overdue = summary.overdue_amount ?? 0;
  const paidPct = poValue > 0 ? (paid / poValue) * 100 : 0;

  const poGroups = data?.purchase_order_status?.grouped || [];
  const pipeline = data?.request_pipeline || [];
  const attention = (data?.attention_items || []).slice(0, 5);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={COLORS.text} />}
      >
        <View style={styles.greeting}>
          <Text style={styles.hello}>
            {greeting()}، {user?.display_name || user?.username || ''}
          </Text>
          <Text style={styles.subHello}>
            {roleLabel(user?.role)} · {formatLongDate(toIsoDate(new Date()))}
          </Text>
        </View>

        <ErrorBanner message={error} onRetry={refresh} />

        {loading ? (
          <View style={styles.skeleton}>
            <SkeletonLoader variant="detail" count={1} />
            <SkeletonLoader variant="grid" count={6} />
          </View>
        ) : data ? (
          <>
            <View style={styles.hero}>
              <View style={styles.heroTop}>
                <Text style={styles.heroLabel}>قيمة أوامر الشراء</Text>
                <MaterialCommunityIcons name="cash-multiple" size={22} color={COLORS.textSecondary} />
              </View>
              <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
                {formatCurrency(poValue)}
              </Text>
              <ProgressBar
                value={paid}
                total={poValue}
                startCaption={`مدفوع ${formatCurrency(paid)}`}
                endCaption={formatPercent(paidPct)}
              />
              <View style={styles.heroRow}>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatLabel}>المتبقي للموردين</Text>
                  <Text style={[styles.heroStatValue, { color: COLORS.warning }]}>
                    {formatCurrency(outstanding)}
                  </Text>
                </View>
                {overdue > 0 ? (
                  <View style={styles.heroStat}>
                    <Text style={styles.heroStatLabel}>متأخر السداد</Text>
                    <Text style={[styles.heroStatValue, { color: COLORS.danger }]}>
                      {formatCurrency(overdue)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.grid}>
              {KPIS.map((kpi) => (
                <KPICard
                  key={kpi.key}
                  icon={kpi.icon}
                  label={kpi.label}
                  color={kpi.color}
                  value={formatCount(kpi.from ? data[kpi.from]?.[kpi.key] : data[kpi.key])}
                  onPress={kpi.href ? () => router.navigate({ pathname: kpi.href, params: { status: '' } }) : undefined}
                />
              ))}
            </View>

            {poGroups.length ? (
              <>
                <SectionTitle title="أوامر الشراء حسب الحالة" />
                <Card>
                  <BarChart
                    rows={poGroups.map((group) => ({
                      key: group.key,
                      label: group.label,
                      count: group.count,
                      color: PO_GROUP_COLORS[group.key],
                      onPress: () =>
                        router.push({
                          pathname: '/purchase-orders',
                          params: { status: PO_GROUP_STATUS[group.key] || '' },
                        }),
                    }))}
                  />
                </Card>
              </>
            ) : null}

            {pipeline.length ? (
              <>
                <SectionTitle title="مراحل طلبات الشراء" />
                <Card>
                  <BarChart
                    rows={pipeline.map((stage) => ({
                      key: stage.key,
                      label: stage.label,
                      count: stage.count,
                      onPress: () =>
                        router.navigate({
                          pathname: '/requests',
                          params: { status: REQUEST_STAGE_STATUS[stage.key] || '' },
                        }),
                    }))}
                  />
                </Card>
              </>
            ) : null}

            {attention.length ? (
              <>
                <SectionTitle title="يحتاج انتباهك" hint={formatCount(data.attention_items.length)} />
                {attention.map((item, index) => (
                  <Card
                    key={`${item.type}-${item.reference}-${index}`}
                    tone={COLORS.warning}
                    onPress={item.path ? () => openPath(item.path) : undefined}
                  >
                    <Text style={styles.attentionRef}>{item.reference || '—'}</Text>
                    <Text style={styles.attentionReason}>{item.reason}</Text>
                    {item.project_name ? <Text style={styles.attentionMeta}>{item.project_name}</Text> : null}
                  </Card>
                ))}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  content: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.xl },
  skeleton: { marginHorizontal: -SPACING.md },
  greeting: { paddingTop: SPACING.sm, paddingBottom: SPACING.md },
  hello: { color: COLORS.text, fontSize: FONT.xxl, fontWeight: '700', textAlign: 'right' },
  subHello: { color: COLORS.muted, fontSize: FONT.sm + 1, textAlign: 'right', marginTop: SPACING.xs },
  hero: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOW,
  },
  heroTop: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  heroLabel: { color: COLORS.textSecondary, fontSize: FONT.body },
  heroValue: {
    color: COLORS.text,
    fontSize: FONT.display,
    fontWeight: '800',
    textAlign: 'right',
    marginVertical: SPACING.sm,
  },
  heroRow: { flexDirection: 'row-reverse', gap: SPACING.lg, marginTop: SPACING.sm + SPACING.xs },
  heroStat: { alignItems: 'flex-end' },
  heroStatLabel: { color: COLORS.textSecondary, fontSize: FONT.sm },
  heroStatValue: { fontSize: FONT.lg, fontWeight: '700', marginTop: SPACING.xxs },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', justifyContent: 'space-between' },
  attentionRef: { color: COLORS.text, fontWeight: '700', textAlign: 'right' },
  attentionReason: { color: COLORS.textSecondary, textAlign: 'right', marginTop: SPACING.xxs },
  attentionMeta: { color: COLORS.muted, fontSize: FONT.sm, textAlign: 'right', marginTop: SPACING.xxs },
});
