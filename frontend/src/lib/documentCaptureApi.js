import axios from "axios";
import { BACKEND_URL } from "@/lib/api";

const baseURL = `${BACKEND_URL}/api`;
// Longer than lib/api.js's default: document extraction can legitimately
// take up to DOCUMENT_PROVIDER_TIMEOUT_SECONDS (120s, see backend/.env.example)
// on the server, so the client timeout must stay above that, not match the
// app-wide 30s default (see docs/performance-reliability-audit.md).
const DOCUMENT_TIMEOUT_MS = 150_000;
export const publicDocumentApi = axios.create({
  baseURL: `${baseURL}/public/purchase-requests`,
  timeout: DOCUMENT_TIMEOUT_MS,
});
export const internalDocumentApi = axios.create({
  baseURL: `${baseURL}/internal/incoming-purchase-requests`,
  timeout: DOCUMENT_TIMEOUT_MS,
});

internalDocumentApi.interceptors.request.use((config) => {
  const token = window.sessionStorage.getItem(
    "incoming_request_internal_token",
  );
  if (token) config.headers["X-Internal-Token"] = token;
  const authToken = window.localStorage.getItem("procurex-auth-token");
  if (authToken) config.headers.Authorization = `Bearer ${authToken}`;
  return config;
});

export const documentError = (error) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (detail?.code) return detail.code;
  return error?.message || "Request failed";
};
