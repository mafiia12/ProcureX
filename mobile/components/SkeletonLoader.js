import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { COLORS, RADIUS, SPACING } from '../constants/theme';

function usePulse() {
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
}

// Placeholder cards shown while a list/detail loads.
// variant: 'list' (stacked cards) | 'detail' (header block + rows) | 'grid' (KPI tiles)
export default function SkeletonLoader({ variant = 'list', count = 5 }) {
  const opacity = usePulse();
  const Bar = ({ width, height = 12, style }) => (
    <Animated.View style={[styles.bar, { width, height, opacity }, style]} />
  );

  if (variant === 'grid') {
    return (
      <View style={[styles.wrap, styles.grid]}>
        {Array.from({ length: count }, (_, i) => (
          <View key={i} style={[styles.card, styles.tile]}>
            <Bar width="40%" height={20} />
            <Bar width="70%" style={styles.gap} />
          </View>
        ))}
      </View>
    );
  }

  if (variant === 'detail') {
    return (
      <View style={styles.wrap}>
        <View style={styles.card}>
          <Bar width="50%" height={20} />
          <Bar width="30%" style={styles.gap} />
          <Bar width="80%" style={styles.gap} />
        </View>
        {Array.from({ length: count }, (_, i) => (
          <View key={i} style={styles.card}>
            <Bar width="60%" />
            <Bar width="90%" style={styles.gap} />
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.card}>
          <View style={styles.row}>
            <Bar width="35%" height={16} />
            <Bar width="22%" height={16} />
          </View>
          <Bar width="70%" style={styles.gap} />
          <Bar width="45%" style={styles.gap} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: SPACING.md },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md - SPACING.xs,
    marginBottom: SPACING.sm + SPACING.xs,
    alignItems: 'flex-end',
  },
  tile: { width: '48%' },
  row: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignSelf: 'stretch' },
  bar: { backgroundColor: COLORS.border, borderRadius: RADIUS.sm },
  gap: { marginTop: SPACING.sm },
});
