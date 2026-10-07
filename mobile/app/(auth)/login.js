import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';

import { COLORS } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { API_URL } from '../../services/config';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setError('يرجى إدخال اسم المستخدم وكلمة المرور');
      return;
    }
    setLoading(true);
    setError('');
    const result = await signIn(username, password);
    // On success the root Stack.Protected guard switches to (tabs).
    if (!result.success) {
      setError(result.error);
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>ProcureX</Text>
      <Text style={styles.subtitle}>نظام إدارة المشتريات</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TextInput
        style={styles.input}
        placeholder="اسم المستخدم"
        placeholderTextColor={COLORS.muted}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
        returnKeyType="next"
      />
      <TextInput
        style={styles.input}
        placeholder="كلمة المرور"
        placeholderTextColor={COLORS.muted}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        editable={!loading}
        returnKeyType="go"
        onSubmitEditing={handleLogin}
      />

      <Pressable
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleLogin}
        disabled={loading}
      >
        <Text style={styles.buttonText}>
          {loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
        </Text>
      </Pressable>

      <Text style={styles.server}>{API_URL}</Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 32, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  subtitle: { fontSize: 16, color: COLORS.textSecondary, marginBottom: 40 },
  error: { color: COLORS.danger, marginBottom: 16, textAlign: 'center', fontSize: 14 },
  input: {
    width: '100%',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
    color: COLORS.text,
    fontSize: 14,
    textAlign: 'right',
  },
  button: {
    width: '100%',
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  server: { color: COLORS.muted, fontSize: 11, marginTop: 24 },
});
