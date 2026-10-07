import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { COLORS, FONT, RADIUS, SPACING } from '../constants/theme';

// Horizontal single-select chips. options: [{ value, label, count? }].
export default function FilterChips({ options, value, onChange }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // The app lays out RTL by hand (row-reverse), so a plain horizontal
      // ScrollView would start on the left. Mirroring the scroller and
      // un-mirroring each chip makes the first chip ("الكل") start on the right.
      contentContainerStyle={styles.strip}
      style={styles.scroller}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.text, active && styles.textActive]}>
              {option.label}
              {option.count !== undefined ? ` (${option.count})` : ''}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroller: { flexGrow: 0, marginBottom: SPACING.sm, transform: [{ scaleX: -1 }] },
  strip: { paddingHorizontal: SPACING.md, gap: SPACING.sm },
  chip: {
    transform: [{ scaleX: -1 }],
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    paddingHorizontal: SPACING.sm + SPACING.xs,
    paddingVertical: SPACING.xs + 2,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.accent },
  text: { color: COLORS.textSecondary, fontSize: FONT.sm + 1 },
  textActive: { color: COLORS.text, fontWeight: '700' },
});
