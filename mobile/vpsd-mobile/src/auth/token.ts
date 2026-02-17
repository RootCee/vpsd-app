import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "vpsd_auth_token";

/**
 * Save JWT token to secure storage
 */
export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

/**
 * Get JWT token from secure storage
 */
export async function getToken(): Promise<string | null> {
  return await SecureStore.getItemAsync(TOKEN_KEY);
}

/**
 * Clear JWT token from secure storage
 */
export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
