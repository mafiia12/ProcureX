import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLORS } from '../constants/colors';

export default function ErrorBanner({ message, onRetry }) {
  if (!message) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.retry}>
          <Text style={styles.retryText}>إعادة المحاولة</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: COLORS.danger,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  text: { color: COLORS.danger, fontSize: 14, textAlign: 'right' },
  retry: { marginTop: 8, alignSelf: 'flex-end' },
  retryText: { color: COLORS.text, fontWeight: '600' },
});
