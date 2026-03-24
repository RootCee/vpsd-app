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
  if (status === 401) return "Your session expired. Please sign in again.";
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
    if (
      error.message.includes("Network request failed") ||
      error.message.includes("Failed to fetch") ||
      error.message.includes("NetworkError")
    ) {
      return "Unable to connect right now. Please check your internet connection and try again.";
    }

    return error.message || fallback;
  }

  return fallback;
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

  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;

  try {
    return await fetch(url, {
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
