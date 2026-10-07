import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLORS, FONT, RADIUS, SPACING } from '../constants/theme';

export default function EmptyState({ icon = 'inbox-outline', title, message, actionLabel, onAction }) {
  return (
    <View style={styles.wrap}>
      <MaterialCommunityIcons name={icon} size={48} color={COLORS.border} />
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} style={styles.action}>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: SPACING.xxl, paddingHorizontal: SPACING.lg },
  title: { color: COLORS.textSecondary, fontSize: FONT.lg, fontWeight: '600', marginTop: SPACING.md, textAlign: 'center' },
  message: { color: COLORS.muted, fontSize: FONT.body, marginTop: SPACING.xs, textAlign: 'center' },
  action: {
    marginTop: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  actionText: { color: COLORS.text, fontWeight: '600' },
});
