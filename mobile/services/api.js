import axios from 'axios';

import { API_TIMEOUT, API_URL } from './config';
import { getToken } from './storage';

const apiClient = axios.create({ baseURL: API_URL, timeout: API_TIMEOUT });

// The auth context registers a handler so a 401 anywhere logs the user out.
let unauthorizedHandler = null;
export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

apiClient.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const isLoginCall = error.config?.url?.endsWith('/auth/login');
    if (error.response?.status === 401 && !isLoginCall && unauthorizedHandler) {
      await unauthorizedHandler();
    }
    return Promise.reject(error);
  }
);

export default apiClient;

export const authAPI = {
  login: (username, password) => apiClient.post('/api/auth/login', { username, password }),
  logout: () => apiClient.post('/api/auth/logout'),
  me: () => apiClient.get('/api/auth/me'),
};

export const dashboardAPI = {
  get: () => apiClient.get('/api/dashboard'),
};

export const reportAPI = {
  getDailyReport: (date) => apiClient.get('/api/reports/daily', { params: date ? { date } : {} }),
};

export const requestsAPI = {
  list: (params) => apiClient.get('/api/internal/incoming-purchase-requests', { params }),
};

export const comparisonsAPI = {
  list: () => apiClient.get('/api/price-comparisons'),
};

export const paymentsAPI = {
  list: () => apiClient.get('/api/payments'),
};
