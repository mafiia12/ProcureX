import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { COLORS, RADIUS, SHADOW, SPACING } from '../constants/theme';

// Surface container. Pass `onPress` to make it tappable (adds a chevron and
// press feedback); `tone` draws a colored edge on the right (RTL start).
export default function Card({ children, onPress, style, tone, padded = true }) {
  const edge = tone ? { borderRightWidth: 3, borderRightColor: tone } : null;
  const content = (
    <>
      <View style={styles.body}>{children}</View>
      {onPress ? (
        <MaterialCommunityIcons name="chevron-left" size={20} color={COLORS.muted} style={styles.chevron} />
      ) : null}
    </>
  );

  if (!onPress) {
    return <View style={[styles.card, padded && styles.padded, edge, style]}>{content}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, padded && styles.padded, edge, pressed && styles.pressed, style]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.sm + SPACING.xs,
    ...SHADOW,
  },
  padded: { padding: SPACING.md - SPACING.xs },
  body: { flex: 1 },
  chevron: { marginRight: SPACING.sm },
  pressed: { opacity: 0.75 },
});
