import { StyleSheet, Text, View } from 'react-native';

import { COLORS, FONT, RADIUS, SPACING } from '../constants/theme';

// RTL progress bar (fills from the right) with optional captions under it.
export default function ProgressBar({ value, total, color = COLORS.success, startCaption, endCaption }) {
  const ratio = total > 0 ? Math.min(1, Math.max(0, value / total)) : 0;
  return (
    <View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: color }]} />
      </View>
      {startCaption || endCaption ? (
        <View style={styles.captions}>
          <Text style={styles.caption}>{startCaption}</Text>
          <Text style={styles.caption}>{endCaption}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 10,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
    flexDirection: 'row-reverse',
  },
  fill: { height: '100%', borderRadius: RADIUS.pill },
  captions: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: SPACING.xs },
  caption: { color: COLORS.muted, fontSize: FONT.sm },
});
