import { router } from 'expo-router';
import { Text, View } from 'react-native';

import Card from '../../components/Card';
import DataList, { listStyles } from '../../components/DataList';
import Screen from '../../components/Screen';
import { comparisonsAPI } from '../../services/api';
import { formatDate, formatDateTime } from '../../utils/formatters';

// Price comparisons have no status field in the backend, so this list has
// search only (no status chips).
const searchFields = (item) => [item.comparison_number, item.project_name, item.customer_name, item.notes];

function ComparisonRow({ item }) {
  return (
    <Card onPress={() => router.push(`/comparisons/${item.id}`)}>
      <View style={listStyles.row}>
        <Text style={listStyles.title}>{item.comparison_number || '—'}</Text>
        <Text style={listStyles.meta}>{formatDate(item.comparison_date)}</Text>
      </View>
      <Text style={listStyles.sub} numberOfLines={1}>
        {[item.project_name, item.customer_name].filter(Boolean).join(' · ') || 'بدون مشروع'}
      </Text>
      <Text style={listStyles.meta}>
        {item.row_count} عرض سعر · آخر تحديث {formatDateTime(item.updated_at)}
      </Text>
    </Card>
  );
}

export default function ComparisonsScreen() {
  return (
    <Screen title="مقارنات الأسعار">
      <DataList
        fetcher={comparisonsAPI.list}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ComparisonRow item={item} />}
        searchFields={searchFields}
        searchPlaceholder="رقم المقارنة، المشروع، العميل..."
        emptyIcon="compare-horizontal"
        emptyTitle="لا توجد مقارنات بعد"
        errorText="خطأ في تحميل المقارنات"
      />
    </Screen>
  );
}
