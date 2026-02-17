import * as SecureStore from "expo-secure-store";
import { API_BASE } from "../config";

const TOKEN_KEY = "vpsd_auth_token";

/**
 * Make an authenticated API request with JWT token
 */
export async function authenticatedFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;

  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * Safe JSON parsing helper
 */
export async function safeJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text}`);
  }
}
