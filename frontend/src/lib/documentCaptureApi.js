import axios from "axios";
import { BACKEND_URL } from "@/lib/api";

const baseURL = `${BACKEND_URL}/api`;
export const publicDocumentApi = axios.create({
  baseURL: `${baseURL}/public/purchase-requests`,
});
export const internalDocumentApi = axios.create({
  baseURL: `${baseURL}/internal/incoming-purchase-requests`,
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
