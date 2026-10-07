import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLORS, FONT, RADIUS, SHADOW, SPACING } from '../constants/theme';

// Half-width KPI tile. Tappable when `onPress` is given (shows a chevron).
export default function KPICard({ icon, value, label, color = COLORS.accent, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.top}>
        <View style={[styles.iconWrap, { backgroundColor: `${color}26` }]}>
          <MaterialCommunityIcons name={icon} size={20} color={color} />
        </View>
        {onPress ? <MaterialCommunityIcons name="chevron-left" size={18} color={COLORS.muted} /> : null}
      </View>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.label} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '48%',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.sm + SPACING.xs,
    marginBottom: SPACING.sm + SPACING.xs,
    ...SHADOW,
  },
  pressed: { opacity: 0.75 },
  top: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  iconWrap: { borderRadius: RADIUS.sm, padding: SPACING.xs + 2 },
  value: { fontSize: FONT.xl, fontWeight: '700', color: COLORS.text, marginTop: SPACING.sm, textAlign: 'right' },
  label: { fontSize: FONT.sm, color: COLORS.textSecondary, marginTop: SPACING.xxs, textAlign: 'right' },
});
