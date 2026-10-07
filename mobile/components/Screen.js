import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS } from '../constants/theme';
import ScreenHeader from './ScreenHeader';

// Shared page shell: safe area + header.
export default function Screen({ title, subtitle, back, right, children }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={title} subtitle={subtitle} back={back} right={right} />
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  body: { flex: 1 },
});
