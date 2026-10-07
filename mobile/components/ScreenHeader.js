import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLORS, FONT, SPACING } from '../constants/theme';

// Title row. With `back`, shows an RTL back arrow (on the right) that pops the
// stack, falling back to the dashboard when there is nothing to go back to.
export default function ScreenHeader({ title, subtitle, back = false, right = null }) {
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/dashboard'));

  return (
    <View style={styles.header}>
      {back ? (
        <Pressable onPress={goBack} hitSlop={12} style={styles.back} accessibilityLabel="رجوع">
          <MaterialCommunityIcons name="arrow-right" size={24} color={COLORS.text} />
        </Pressable>
      ) : null}
      <View style={styles.titles}>
        <Text style={[styles.title, back && styles.titleSmall]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  back: { marginLeft: SPACING.sm, padding: SPACING.xs },
  titles: { flex: 1 },
  title: { fontSize: FONT.xxl, fontWeight: '700', color: COLORS.text, textAlign: 'right' },
  titleSmall: { fontSize: FONT.xl },
  subtitle: { fontSize: FONT.sm, color: COLORS.muted, textAlign: 'right', marginTop: SPACING.xxs },
});
