import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import Card from '../../components/Card';
import DataList, { ALL, listStyles } from '../../components/DataList';
import Screen from '../../components/Screen';
import StatusBadge from '../../components/StatusBadge';
import { SPACING } from '../../constants/theme';
import { purchaseOrdersAPI } from '../../services/api';
import { formatCurrency, formatDate } from '../../utils/formatters';

// Not a tab: opened from the dashboard KPIs.
const fetchOrders = () => purchaseOrdersAPI.list();
const searchFields = (item) => [
  item.po_number,
  item.supplier_name,
  item.project_name,
  item.source_request_number,
  item.comparison_number,
];

function OrderRow({ item }) {
  const payment = item.payment_summary;
  return (
    <Card onPress={() => router.push(`/purchase-orders/${item.id}`)}>
      <View style={listStyles.row}>
        <Text style={listStyles.title}>{item.po_number || '—'}</Text>
        <StatusBadge kind="po" value={item.status} />
      </View>
      <Text style={listStyles.sub} numberOfLines={1}>
        {[item.supplier_name, item.project_name].filter(Boolean).join(' · ') || '—'}
      </Text>
      <View style={[listStyles.row, styles.bottom]}>
        <Text style={listStyles.amount}>{formatCurrency(item.final_total)}</Text>
        {payment?.payment_status ? <StatusBadge kind="payment" value={payment.payment_status} small /> : null}
      </View>
      <Text style={listStyles.meta}>
        {formatDate(item.po_date)} · {item.item_count ?? item.items?.length ?? 0} بند
      </Text>
    </Card>
  );
}

export default function PurchaseOrdersScreen() {
  const { status } = useLocalSearchParams();
  return (
    <Screen title="أوامر الشراء" back>
      <DataList
        fetcher={fetchOrders}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <OrderRow item={item} />}
        searchFields={searchFields}
        searchPlaceholder="رقم الأمر، المورد، المشروع..."
        statusKind="po"
        initialStatus={status ? String(status) : ALL}
        emptyIcon="file-document-outline"
        emptyTitle="لا توجد أوامر شراء"
        errorText="خطأ في تحميل أوامر الشراء"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bottom: { marginTop: SPACING.sm },
});
