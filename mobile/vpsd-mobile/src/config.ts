const RENDER = "https://vpsd-app-1.onrender.com";
const LOCAL_FALLBACK = "http://127.0.0.1:8000";

function normalizeBaseUrl(url?: string | null) {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

const configuredBase = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_BASE);

// In development, default to localhost for simulator use and allow physical devices
// to override with EXPO_PUBLIC_API_BASE=http://<your-lan-ip>:8000.
export const API_BASE = __DEV__ ? (configuredBase || LOCAL_FALLBACK) : RENDER;
