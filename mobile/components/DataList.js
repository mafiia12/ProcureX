import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { COLORS, SPACING } from '../constants/theme';
import useApiData from '../hooks/useApiData';
import { matchesSearch, statusLabel, statusOrder } from '../utils/formatters';
import EmptyState from './EmptyState';
import ErrorBanner from './ErrorBanner';
import FilterChips from './FilterChips';
import SearchBar from './SearchBar';
import SkeletonLoader from './SkeletonLoader';

export const ALL = '__all__';
const defaultStatusOf = (item) => item.status;

// Fetch-and-list helper shared by the list screens: client-side search,
// status chips (built from the statuses present in the data), skeleton,
// empty state and pull-to-refresh.
//
// fetcher:      () => axios promise resolving to an array
// searchFields: item => [...strings] searched by the SearchBar
// statusKind:   formatters status vocabulary ('request' | 'po' | ...), enables chips
// statusOf:     item => status value (default item.status)
export default function DataList({
  fetcher,
  renderItem,
  keyExtractor,
  searchFields,
  searchPlaceholder,
  statusKind,
  statusOf = defaultStatusOf,
  initialStatus = ALL,
  emptyIcon,
  emptyTitle = 'لا توجد بيانات',
  errorText,
}) {
  const load = useCallback(async () => {
    const response = await fetcher();
    return Array.isArray(response.data) ? response.data : [];
  }, [fetcher]);
  const { data, loading, refreshing, error, refresh } = useApiData(load, errorText);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(initialStatus);

  // Tabs stay mounted, so a new filter passed from the dashboard must re-apply.
  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  const rows = data || [];

  const chips = useMemo(() => {
    if (!statusKind) return null;
    const counts = {};
    rows.forEach((row) => {
      const value = statusOf(row);
      counts[value] = (counts[value] || 0) + 1;
    });
    const order = statusOrder(statusKind);
    const present = Object.keys(counts).sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    // Keep a pre-selected status visible even when it has no rows.
    if (initialStatus !== ALL && !present.includes(initialStatus)) present.unshift(initialStatus);
    return [
      { value: ALL, label: 'الكل', count: rows.length },
      ...present.map((value) => ({
        value,
        label: statusLabel(statusKind, value),
        count: counts[value] || 0,
      })),
    ];
  }, [rows, statusKind, statusOf, initialStatus]);

  const visible = useMemo(
    () =>
      rows.filter(
        (row) =>
          (status === ALL || statusOf(row) === status) &&
          (!searchFields || matchesSearch(query, ...searchFields(row)))
      ),
    [rows, status, query, searchFields, statusOf]
  );

  const filtered = query.trim() !== '' || status !== ALL;

  return (
    <View style={styles.flex}>
      {searchFields ? (
        <SearchBar value={query} onChangeText={setQuery} placeholder={searchPlaceholder} />
      ) : null}
      {chips && rows.length ? <FilterChips options={chips} value={status} onChange={setStatus} /> : null}
      {loading ? (
        <SkeletonLoader />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={<ErrorBanner message={error} onRetry={refresh} />}
          ListEmptyComponent={
            error ? null : filtered ? (
              <EmptyState
                icon="filter-remove-outline"
                title="لا توجد نتائج مطابقة"
                message="جرّب تعديل البحث أو اختيار حالة أخرى"
                actionLabel="مسح الفلاتر"
                onAction={() => {
                  setQuery('');
                  setStatus(ALL);
                }}
              />
            ) : (
              <EmptyState icon={emptyIcon} title={emptyTitle} message="اسحب للأسفل للتحديث" />
            )
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={COLORS.text} />
          }
        />
      )}
    </View>
  );
}

export const listStyles = StyleSheet.create({
  row: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', gap: SPACING.sm },
  title: { color: COLORS.text, fontWeight: '700', fontSize: 15, textAlign: 'right', flexShrink: 1 },
  sub: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'right', marginTop: SPACING.xs },
  meta: { color: COLORS.muted, fontSize: 12, marginTop: SPACING.xs + 2, textAlign: 'right' },
  amount: { color: COLORS.text, fontWeight: '700', fontSize: 14 },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.lg, flexGrow: 1 },
});
