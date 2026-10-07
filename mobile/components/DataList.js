import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text } from 'react-native';

import { COLORS } from '../constants/colors';
import { errorMessage } from '../utils/formatters';
import ErrorBanner from './ErrorBanner';
import LoadingSpinner from './LoadingSpinner';

// Fetch-and-list helper shared by the simple list tabs.
export default function DataList({ fetcher, renderItem, keyExtractor, emptyText, errorText }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetcher();
      setRows(Array.isArray(response.data) ? response.data : []);
      setError('');
    } catch (err) {
      setError(errorMessage(err, errorText));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetcher, errorText]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingSpinner />;

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  return (
    <FlatList
      data={rows}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      contentContainerStyle={styles.content}
      ListHeaderComponent={<ErrorBanner message={error} onRetry={onRefresh} />}
      ListEmptyComponent={error ? null : <Text style={styles.empty}>{emptyText}</Text>}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.text} />}
    />
  );
}

export const listStyles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  row: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: COLORS.text, fontWeight: '700', fontSize: 15, textAlign: 'right', flexShrink: 1 },
  sub: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'right', marginTop: 4 },
  meta: { color: COLORS.muted, fontSize: 12, marginTop: 6, textAlign: 'right' },
});

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  empty: { color: COLORS.muted, textAlign: 'center', marginTop: 40 },
});
