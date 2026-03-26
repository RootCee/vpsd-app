import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { getToken, setToken as saveToken, clearToken } from "./token";
import { API_BASE } from "../config";
import { apiFetch, ApiError, getErrorMessage, parseApiResponse } from "../api/client";

type User = {
  id: number;
  name: string | null;
  email: string;
  role: string;
  is_active: boolean;
};

type AuthContextType = {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load token on mount
  useEffect(() => {
    loadToken();
  }, []);

  const loadToken = async () => {
    try {
      // Dev-only: Force logout if flag is set
      if (__DEV__ && process.env.EXPO_PUBLIC_FORCE_LOGOUT === "1") {
        console.log("[AuthContext] EXPO_PUBLIC_FORCE_LOGOUT=1 detected, clearing token...");
        await clearToken();
        setTokenState(null);
        setIsLoading(false);
        return;
      }

      const savedToken = await getToken();
      if (__DEV__) {
        console.log("[AuthContext] loadToken - token exists:", !!savedToken);
      }
      if (savedToken) {
        // Validate token against server before trusting it
        try {
          const res = await apiFetch("/auth/me", {
            headers: { Authorization: `Bearer ${savedToken}` },
          });
          if (res.ok) {
            const data = await parseApiResponse<{ user?: User | null }>(res, "Could not restore your session.");
            setTokenState(savedToken);
            setUser(data.user || null);
            if (__DEV__) {
              console.log("[AuthContext] Token valid, user:", data.user?.email);
            }
          } else {
            // Token is expired or invalid — clear it
            if (__DEV__) {
              console.log("[AuthContext] Token invalid (status", res.status, "), clearing");
            }
            await clearToken();
          }
        } catch {
          // Network error — trust the saved token so offline still works
          if (__DEV__) {
            console.log("[AuthContext] Network error validating token, keeping it");
          }
          setTokenState(savedToken);
        }
      }
    } catch (error) {
      console.error("[AuthContext] Failed to load token:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    if (__DEV__) {
      console.log("[AuthContext] Attempting login for:", email);
      console.log("[AuthContext] API_BASE:", API_BASE);
    }

    try {
      const res = await apiFetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (__DEV__) {
        console.log("[AuthContext] Login response status:", res.status);
      }

      const data = await parseApiResponse<{ access_token?: string; user?: User | null }>(
        res,
        "Unable to sign in. Please check your email and password."
      );

      if (__DEV__) {
        console.log("[AuthContext] Login response data:", {
          hasAccessToken: !!data.access_token,
          hasUser: !!data.user,
        });
      }

      if (!data.access_token) {
        throw new Error("No access token received from server");
      }

      await saveToken(data.access_token);
      setTokenState(data.access_token);
      setUser(data.user || null);

      if (__DEV__) {
        console.log("[AuthContext] Login successful, token saved");
      }
    } catch (error: any) {
      if (__DEV__) {
        console.error("[AuthContext] Login error:", error);
      }
      throw new ApiError(getErrorMessage(error, "Unable to sign in. Please try again."));
    }
  };

  const logout = async () => {
    if (__DEV__) {
      console.log("[AuthContext] Logging out, clearing token");
    }
    await clearToken();
    setTokenState(null);
    setUser(null);
    if (__DEV__) {
      console.log("[AuthContext] Logout complete");
    }
  };

  const isAuthenticated = !!token;

  return (
    <AuthContext.Provider value={{ user, token, isLoading, isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
