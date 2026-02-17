import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { getToken, setToken as saveToken, clearToken } from "./token";
import { API_BASE } from "../config";

type User = {
  id: number;
  email: string;
  is_active: boolean;
};

type AuthContextType = {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
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
        if (savedToken) {
          console.log("[AuthContext] Token preview:", savedToken.substring(0, 20) + "...");
        }
      }
      if (savedToken) {
        setTokenState(savedToken);
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
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (__DEV__) {
        console.log("[AuthContext] Login response status:", res.status);
      }

      if (!res.ok) {
        // Try to parse JSON error, fallback to text, then fallback to generic message
        let errorMessage = "Login failed";
        try {
          const errorData = await res.json();
          errorMessage = errorData.detail || errorData.message || JSON.stringify(errorData);
        } catch {
          // If JSON parsing fails, try to read as text
          try {
            const errorText = await res.text();
            errorMessage = errorText || `Login failed with status ${res.status}`;
          } catch {
            errorMessage = `Login failed with status ${res.status}`;
          }
        }

        if (__DEV__) {
          console.error("[AuthContext] Login failed:", errorMessage);
        }
        throw new Error(errorMessage);
      }

      const data = await res.json();

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
      // Re-throw with a more user-friendly message if it's a network error
      if (error.message.includes("Network request failed") || error.message.includes("Failed to fetch")) {
        throw new Error("Network error. Please check your connection and try again.");
      }
      throw error;
    }
  };

  const register = async (email: string, password: string) => {
    if (__DEV__) {
      console.log("[AuthContext] Attempting registration for:", email);
      console.log("[AuthContext] API_BASE:", API_BASE);
    }

    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (__DEV__) {
        console.log("[AuthContext] Register response status:", res.status);
      }

      if (!res.ok) {
        // Try to parse JSON error, fallback to text, then fallback to generic message
        let errorMessage = "Registration failed";
        try {
          const errorData = await res.json();
          errorMessage = errorData.detail || errorData.message || JSON.stringify(errorData);
        } catch {
          // If JSON parsing fails, try to read as text
          try {
            const errorText = await res.text();
            errorMessage = errorText || `Registration failed with status ${res.status}`;
          } catch {
            errorMessage = `Registration failed with status ${res.status}`;
          }
        }

        if (__DEV__) {
          console.error("[AuthContext] Registration failed:", errorMessage);
        }
        throw new Error(errorMessage);
      }

      const data = await res.json();

      if (__DEV__) {
        console.log("[AuthContext] Register response data:", {
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
        console.log("[AuthContext] Registration successful, token saved");
      }
    } catch (error: any) {
      if (__DEV__) {
        console.error("[AuthContext] Registration error:", error);
      }
      // Re-throw with a more user-friendly message if it's a network error
      if (error.message.includes("Network request failed") || error.message.includes("Failed to fetch")) {
        throw new Error("Network error. Please check your connection and try again.");
      }
      throw error;
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
    <AuthContext.Provider value={{ user, token, isLoading, isAuthenticated, login, register, logout }}>
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
