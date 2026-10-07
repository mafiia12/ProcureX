import { errorMessage } from '../utils/formatters';
import { authAPI } from './api';
import { clearSession, getStoredUser, getToken, saveSession } from './storage';

// POST /api/auth/login → { access_token, token_type, user }
export async function login(username, password) {
  try {
    const { data } = await authAPI.login(username.trim(), password);
    await saveSession(data.access_token, data.user);
    return { success: true, user: data.user };
  } catch (error) {
    return { success: false, error: errorMessage(error, 'خطأ في تسجيل الدخول') };
  }
}

export async function logout() {
  try {
    await authAPI.logout();
  } catch {
    // Stateless JWT: discard the token locally even if the call fails.
  }
  await clearSession();
}

// Returns the stored user when a token exists, otherwise null.
export async function restoreSession() {
  const token = await getToken();
  return token ? getStoredUser() : null;
}
