import axios from "axios";

const publicApiOrigin = (
  process.env.REACT_APP_PUBLIC_API_URL
  || process.env.REACT_APP_BACKEND_URL
  || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

export const publicRequestApi = axios.create({
  baseURL: `${publicApiOrigin}/api/public/purchase-requests`,
  timeout: 30_000,
});

export const requestError = (error) => {
  const detail = error?.response?.data?.detail;
  return typeof detail === "string" ? detail : "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى";
};
