import { StyleSheet, Text, View } from 'react-native';

import DataList, { listStyles } from '../../components/DataList';
import Screen from '../../components/Screen';
import { COLORS } from '../../constants/colors';
import { requestsAPI } from '../../services/api';
import { formatDateTime } from '../../utils/formatters';

// Values from REQUEST_STATUSES / PRIORITIES in backend/incoming_requests.py.
const STATUS_LABELS = {
  new: 'جديد',
  under_review: 'قيد المراجعة',
  need_clarification: 'يحتاج توضيح',
  pricing: 'قيد التسعير',
  waiting_for_approval: 'بانتظار الاعتماد',
  approved: 'معتمد',
  rejected: 'مرفوض',
  converted_to_purchase: 'تحول لشراء',
  completed: 'مكتمل',
  cancelled: 'ملغي',
  hold: 'معلق',
};
const PRIORITY_COLORS = {
  urgent: COLORS.danger,
  high: COLORS.warning,
  normal: COLORS.accent,
  low: COLORS.muted,
};

const fetchRequests = () => requestsAPI.list();

function RequestRow({ item }) {
  return (
    <View style={listStyles.card}>
      <View style={listStyles.row}>
        <Text style={listStyles.title}>{item.request_number}</Text>
        <Text style={[styles.status, { borderColor: PRIORITY_COLORS[item.priority] || COLORS.border }]}>
          {STATUS_LABELS[item.status] || item.status}
        </Text>
      </View>
      <Text style={listStyles.sub}>
        {[item.requester_name, item.project_name].filter(Boolean).join(' · ')}
      </Text>
      <Text style={listStyles.meta}>
        {item.item_count} بند · {formatDateTime(item.created_at)}
      </Text>
    </View>
  );
}

export default function RequestsScreen() {
  return (
    <Screen title="طلبات الشراء">
      <DataList
        fetcher={fetchRequests}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <RequestRow item={item} />}
        emptyText="لا توجد طلبات"
        errorText="خطأ في تحميل الطلبات"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: {
    color: COLORS.text,
    fontSize: 12,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
});
