import axios from "axios";
import { BACKEND_URL } from "@/lib/api";

// See lib/api.js for why this needs an explicit timeout.
export const internalRequestApi = axios.create({
  baseURL: `${BACKEND_URL}/api/internal/incoming-purchase-requests`,
  timeout: 30_000,
});

internalRequestApi.interceptors.request.use((config) => {
  const token = typeof window !== "undefined"
    ? window.sessionStorage.getItem("incoming_request_internal_token")
    : "";
  if (token) config.headers["X-Internal-Token"] = token;
  const authToken = typeof window !== "undefined"
    ? window.localStorage.getItem("procurex-auth-token")
    : "";
  if (authToken) config.headers.Authorization = `Bearer ${authToken}`;
  return config;
});

export const requestError = (error) => {
  const detail = error?.response?.data?.detail;
  return typeof detail === "string" ? detail : "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى";
};
