import { Text, View } from 'react-native';

import DataList, { listStyles } from '../../components/DataList';
import Screen from '../../components/Screen';
import { comparisonsAPI } from '../../services/api';
import { formatDateTime } from '../../utils/formatters';

function ComparisonRow({ item }) {
  return (
    <View style={listStyles.card}>
      <View style={listStyles.row}>
        <Text style={listStyles.title}>{item.comparison_number || '—'}</Text>
        <Text style={listStyles.sub}>{item.comparison_date}</Text>
      </View>
      <Text style={listStyles.sub}>
        {[item.project_name, item.customer_name].filter(Boolean).join(' · ') || 'بدون مشروع'}
      </Text>
      <Text style={listStyles.meta}>
        {item.row_count} بند · آخر تحديث {formatDateTime(item.updated_at)}
      </Text>
    </View>
  );
}

export default function ComparisonsScreen() {
  return (
    <Screen title="مقارنات الأسعار">
      <DataList
        fetcher={comparisonsAPI.list}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ComparisonRow item={item} />}
        emptyText="لا توجد مقارنات بعد"
        errorText="خطأ في تحميل المقارنات"
      />
    </Screen>
  );
}
