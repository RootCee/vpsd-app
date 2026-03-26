import { getToken } from "../auth/token";
import { API_BASE } from "../config";

export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 10000;

function parseJsonText<T>(text: string): T {
  return JSON.parse(text) as T;
}

function isLikelyHtml(text: string) {
  const trimmed = text.trim().toLowerCase();
  return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html");
}

function normalizeServerMessage(message?: string | null) {
  const trimmed = message?.trim();
  if (!trimmed || isLikelyHtml(trimmed)) return null;
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}

function buildApiErrorMessage(status: number, serverMessage?: string | null, fallback = "Request failed") {
  if (status === 401) {
    const normalized = normalizeServerMessage(serverMessage);
    if (normalized) {
      const lower = normalized.toLowerCase();
      if (
        lower.includes("invalid email or password") ||
        lower.includes("invalid authentication credentials") ||
        lower.includes("not authenticated") ||
        lower.includes("could not validate credentials")
      ) {
        return normalized;
      }
    }
    return "Your session expired. Please sign in again.";
  }
  if (status === 403) return "You do not have permission to perform this action.";
  if (status === 404) return "The requested data is unavailable right now.";
  if (status >= 500) return "The service is temporarily unavailable. Please try again.";
  return normalizeServerMessage(serverMessage) || fallback;
}

export function getErrorMessage(error: unknown, fallback = "Something went wrong. Please try again.") {
  if (error instanceof ApiError) {
    return error.message || fallback;
  }

  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return `Request timed out while reaching ${API_BASE}. If you're testing on a phone, make sure the backend is running and EXPO_PUBLIC_API_BASE points to your computer's LAN IP.`;
    }

    if (
      error.message.includes("Network request failed") ||
      error.message.includes("Failed to fetch") ||
      error.message.includes("NetworkError")
    ) {
      return `Unable to reach ${API_BASE}. If you're testing on a phone, make sure the backend is running with --host 0.0.0.0 and EXPO_PUBLIC_API_BASE is set to your computer's LAN IP.`;
    }

    return error.message || fallback;
  }

  return fallback;
}

async function requestWithTimeout(url: string, options: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: options.signal ?? controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function apiFetch(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;

  try {
    return await requestWithTimeout(url, options, timeoutMs);
  } catch (error) {
    throw new ApiError(getErrorMessage(error), undefined);
  }
}

/**
 * Make an authenticated API request with JWT token
 */
export async function authenticatedFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getToken();

  if (__DEV__) {
    console.log("[authenticatedFetch]", endpoint, "token?", token ? token.substring(0, 15) + "..." : "NULL");
  }

  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  try {
    return await apiFetch(endpoint, {
      ...options,
      headers,
    });
  } catch (error) {
    throw new ApiError(getErrorMessage(error), undefined);
  }
}

/**
 * Safe JSON parsing helper
 */
export async function safeJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return parseJsonText<T>(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text}`);
  }
}

export async function parseApiResponse<T>(
  res: Response,
  fallback = `Request failed (${res.status})`
): Promise<T> {
  const text = await res.text();
  const data = text ? (() => {
    try {
      return parseJsonText<T & { detail?: string; message?: string; error?: string }>(text);
    } catch {
      return null;
    }
  })() : null;

  if (!res.ok) {
    const serverMessage =
      typeof data === "object" && data
        ? data.detail || data.message || data.error
        : text;
    throw new ApiError(buildApiErrorMessage(res.status, serverMessage, fallback), res.status);
  }

  if (!text) {
    return {} as T;
  }

  if (data) {
    return data;
  }

  throw new ApiError(buildApiErrorMessage(res.status, text, fallback), res.status);
}
