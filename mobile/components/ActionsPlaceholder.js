import { StyleSheet, Text, View } from 'react-native';

import { COLORS, FONT, RADIUS, SPACING } from '../constants/theme';

// PHASE 2: reserved slot at the bottom of each detail screen for action
// buttons (approve / receive / pay ...). Intentionally inert in Phase 1.
export default function ActionsPlaceholder() {
  return (
    <View style={styles.box}>
      <Text style={styles.text}>الإجراءات متاحة في المرحلة القادمة</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: SPACING.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  text: { color: COLORS.muted, fontSize: FONT.sm },
});
