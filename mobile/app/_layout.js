import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import LoadingSpinner from '../components/LoadingSpinner';
import { COLORS } from '../constants/colors';
import { AuthProvider, useAuth } from '../context/AuthContext';

function RootNavigator() {
  const { isLoading, isLoggedIn } = useAuth();
  if (isLoading) return <LoadingSpinner />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.bg } }}>
      <Stack.Protected guard={!isLoggedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={isLoggedIn}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <RootNavigator />
    </AuthProvider>
  );
}
