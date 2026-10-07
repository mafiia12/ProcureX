import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLORS, FONT, RADIUS, SPACING } from '../constants/theme';

// Horizontal bar chart built from plain Views (no SVG / native deps), RTL:
// label on the right, bar grows from the right. rows: [{ key, label, count,
// color?, onPress? }]. Bars are scaled to the largest count.
export default function BarChart({ rows, color = COLORS.accent, formatValue = String }) {
  const max = Math.max(1, ...rows.map((row) => Number(row.count) || 0));
  return (
    <View>
      {rows.map((row) => {
        const count = Number(row.count) || 0;
        const pct = (count / max) * 100;
        const content = (
          <View style={[styles.row, count === 0 && styles.zero]}>
            <Text style={styles.label} numberOfLines={1}>
              {row.label}
            </Text>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  { width: `${count ? Math.max(pct, 3) : 0}%`, backgroundColor: row.color || color },
                ]}
              />
            </View>
            <Text style={styles.value}>{formatValue(count)}</Text>
          </View>
        );
        return row.onPress ? (
          <Pressable key={row.key} onPress={row.onPress} style={({ pressed }) => pressed && styles.pressed}>
            {content}
          </Pressable>
        ) : (
          <View key={row.key}>{content}</View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row-reverse', alignItems: 'center', paddingVertical: SPACING.xs + 2 },
  zero: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
  label: { width: 110, color: COLORS.textSecondary, fontSize: FONT.sm + 1, textAlign: 'right' },
  track: {
    flex: 1,
    height: 12,
    marginHorizontal: SPACING.sm,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
    flexDirection: 'row-reverse',
  },
  fill: { height: '100%', borderRadius: RADIUS.pill },
  value: { minWidth: 28, color: COLORS.text, fontWeight: '700', fontSize: FONT.body, textAlign: 'left' },
});
