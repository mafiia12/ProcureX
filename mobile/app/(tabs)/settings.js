import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Card from '../../components/Card';
import InfoRow from '../../components/InfoRow';
import Screen from '../../components/Screen';
import SectionTitle from '../../components/SectionTitle';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { authAPI } from '../../services/api';
import { API_URL } from '../../services/config';
import { roleLabel } from '../../utils/formatters';

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
        <SectionTitle title="الحساب" />
        <Card>
          <InfoRow label="الاسم" value={user?.display_name} />
          <InfoRow label="اسم المستخدم" value={user?.username} />
          <InfoRow label="الدور" value={roleLabel(user?.role)} last />
        </Card>
        <SectionTitle title="الاتصال" />
        <Card>
          <InfoRow label="الخادم" value={API_URL} last />
        </Card>
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
  content: { paddingHorizontal: SPACING.md },
  logout: {
    backgroundColor: COLORS.danger,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm + SPACING.xs,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  disabled: { opacity: 0.6 },
  logoutText: { color: COLORS.text, fontWeight: '600' },
});
