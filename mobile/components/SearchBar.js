import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { COLORS, FONT, RADIUS, SPACING } from '../constants/theme';

export default function SearchBar({ value, onChangeText, placeholder = 'بحث...' }) {
  return (
    <View style={styles.bar}>
      <MaterialCommunityIcons name="magnify" size={20} color={COLORS.muted} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.muted}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="never"
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityLabel="مسح البحث">
          <MaterialCommunityIcons name="close-circle" size={18} color={COLORS.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm + SPACING.xs,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  input: {
    flex: 1,
    color: COLORS.text,
    fontSize: FONT.body,
    textAlign: 'right',
    paddingVertical: SPACING.sm + 2,
    marginHorizontal: SPACING.sm,
  },
});
