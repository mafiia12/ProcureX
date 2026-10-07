import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { COLORS } from '../constants/colors';

export default function KPICard({ icon, value, label, color = COLORS.accent }) {
  return (
    <View style={styles.card}>
      <MaterialCommunityIcons name={icon} size={24} color={color} />
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '48%',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  value: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginTop: 8 },
  label: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4, textAlign: 'center' },
});
