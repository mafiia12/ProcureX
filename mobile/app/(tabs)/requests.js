import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import Card from '../../components/Card';
import DataList, { ALL, listStyles } from '../../components/DataList';
import Screen from '../../components/Screen';
import StatusBadge from '../../components/StatusBadge';
import { COLORS, SPACING } from '../../constants/theme';
import { requestsAPI } from '../../services/api';
import { formatDateTime } from '../../utils/formatters';

const fetchRequests = () => requestsAPI.list();
const searchFields = (item) => [
  item.request_number,
  item.requester_name,
  item.company_name,
  item.project_name,
  item.phone_number,
];

const PRIORITY_EDGE = { urgent: COLORS.danger, high: COLORS.warning };

function RequestRow({ item }) {
  const showPriority = item.priority === 'urgent' || item.priority === 'high';
  return (
    <Card
      onPress={() => router.push(`/requests/${item.id}`)}
      tone={PRIORITY_EDGE[item.priority]}
    >
      <View style={listStyles.row}>
        <Text style={listStyles.title}>{item.request_number}</Text>
        <StatusBadge kind="request" value={item.status} />
      </View>
      <Text style={listStyles.sub} numberOfLines={1}>
        {[item.project_name, item.requester_name].filter(Boolean).join(' · ') || '—'}
      </Text>
      <View style={[listStyles.row, styles.metaRow]}>
        <Text style={listStyles.meta}>
          {item.item_count} بند · {formatDateTime(item.created_at)}
        </Text>
        {showPriority ? <StatusBadge kind="priority" value={item.priority} small /> : null}
      </View>
    </Card>
  );
}

export default function RequestsScreen() {
  // Optional ?status=... when opened from a dashboard KPI / chart bar.
  const { status } = useLocalSearchParams();
  const initialStatus = status ? String(status) : ALL;

  return (
    <Screen title="طلبات الشراء">
      <DataList
        fetcher={fetchRequests}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <RequestRow item={item} />}
        searchFields={searchFields}
        searchPlaceholder="رقم الطلب، المشروع، مقدم الطلب..."
        statusKind="request"
        initialStatus={initialStatus}
        emptyIcon="inbox-outline"
        emptyTitle="لا توجد طلبات"
        errorText="خطأ في تحميل الطلبات"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  metaRow: { marginTop: SPACING.xxs },
});
