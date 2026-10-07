import { StyleSheet, Text, View } from 'react-native';

import { COLORS, FONT, SPACING } from '../constants/theme';

// Label on the right, value on the left. `value` may be a string or a node
// (e.g. a StatusBadge). Empty values render as "—".
export default function InfoRow({ label, value, valueColor, last = false, onPressValue }) {
  const isNode = value !== null && typeof value === 'object';
  const empty = value === null || value === undefined || value === '';
  return (
    <View style={[styles.row, last && styles.last]}>
      <Text style={styles.label}>{label}</Text>
      {isNode ? (
        <View style={styles.nodeValue}>{value}</View>
      ) : (
        <Text
          style={[styles.value, valueColor && { color: valueColor }, onPressValue && styles.link]}
          onPress={onPressValue}
          numberOfLines={2}
        >
          {empty ? '—' : String(value)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm + 2,
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  last: { borderBottomWidth: 0 },
  label: { color: COLORS.textSecondary, fontSize: FONT.body, marginLeft: SPACING.md },
  value: { color: COLORS.text, fontWeight: '600', fontSize: FONT.body, flexShrink: 1, textAlign: 'left' },
  nodeValue: { flexShrink: 1, alignItems: 'flex-start' },
  link: { color: COLORS.accent, textDecorationLine: 'underline' },
});
