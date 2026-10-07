import { StyleSheet, Text, View } from 'react-native';

import { COLORS, FONT, SPACING } from '../constants/theme';

export default function SectionTitle({ title, hint, right }) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'baseline',
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  title: { color: COLORS.text, fontSize: FONT.lg, fontWeight: '700', textAlign: 'right' },
  hint: { color: COLORS.muted, fontSize: FONT.sm, marginRight: SPACING.sm },
  right: { marginRight: 'auto' },
});
