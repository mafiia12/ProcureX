import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Screen from '../../components/Screen';
import { COLORS } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { authAPI } from '../../services/api';
import { API_URL } from '../../services/config';

function InfoRow({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={1}>{value || '—'}</Text>
    </View>
  );
}

export default function SettingsScreen() {
  const { user: storedUser, signOut } = useAuth();
  const [user, setUser] = useState(storedUser);
  const [signingOut, setSigningOut] = useState(false);

  // Refresh the profile from /api/auth/me; keep the cached copy on failure.
  useEffect(() => {
    authAPI.me().then((response) => setUser(response.data)).catch(() => {});
  }, []);

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
  };

  return (
    <Screen title="الإعدادات">
      <View style={styles.content}>
        <View style={styles.card}>
          <InfoRow label="الاسم" value={user?.display_name} />
          <InfoRow label="اسم المستخدم" value={user?.username} />
          <InfoRow label="الدور" value={user?.role} />
        </View>
        <View style={styles.card}>
          <InfoRow label="الخادم" value={API_URL} />
        </View>
        <Pressable
          style={[styles.logout, signingOut && styles.disabled]}
          onPress={handleSignOut}
          disabled={signingOut}
        >
          <Text style={styles.logoutText}>{signingOut ? 'جاري الخروج...' : 'تسجيل الخروج'}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16 },
  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { color: COLORS.textSecondary },
  value: { color: COLORS.text, fontWeight: '600', flexShrink: 1, marginRight: 12 },
  logout: { backgroundColor: COLORS.danger, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  disabled: { opacity: 0.6 },
  logoutText: { color: COLORS.text, fontWeight: '600' },
});
