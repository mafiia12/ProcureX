import Constants from 'expo-constants';
import { Platform } from 'react-native';

const BACKEND_PORT = 8000;

// Resolve the backend URL. An explicit EXPO_PUBLIC_API_URL always wins.
// Otherwise, in development, reuse the LAN host that Expo serves the bundle
// from (works for real devices and emulators), falling back to the
// emulator/simulator loopback address.
function resolveApiUrl() {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const hostUri = Constants.expoConfig?.hostUri; // e.g. "192.168.1.20:8081"
  const host = hostUri?.split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    return `http://${host}:${BACKEND_PORT}`;
  }
  const loopback = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
  return `http://${loopback}:${BACKEND_PORT}`;
}

export const API_URL = resolveApiUrl();
export const API_TIMEOUT = parseInt(process.env.EXPO_PUBLIC_API_TIMEOUT || '10000', 10);
