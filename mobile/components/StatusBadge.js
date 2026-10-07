import { StyleSheet, Text, View } from 'react-native';

import { FONT, RADIUS, SPACING, TONES } from '../constants/theme';
import { statusMeta } from '../utils/formatters';

// Colored pill. Either pass kind + value (looked up in formatters.statusMeta),
// or an explicit label + tone.
export default function StatusBadge({ kind, value, label, tone, small = false }) {
  const meta = kind ? statusMeta(kind, value) : { label, tone: tone || 'neutral' };
  const colors = TONES[meta.tone] || TONES.neutral;
  return (
    <View style={[styles.badge, small && styles.small, { backgroundColor: colors.bg }]}>
      <Text style={[styles.text, small && styles.smallText, { color: colors.fg }]} numberOfLines={1}>
        {meta.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.sm + SPACING.xxs,
    paddingVertical: SPACING.xxs + 1,
    alignSelf: 'flex-start',
  },
  small: { paddingHorizontal: SPACING.sm - 2, paddingVertical: 1 },
  text: { fontSize: FONT.sm, fontWeight: '600' },
  smallText: { fontSize: FONT.xs },
});
