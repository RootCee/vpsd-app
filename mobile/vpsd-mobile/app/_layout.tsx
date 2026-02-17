import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';

// REMOVED unstable_settings anchor - it was forcing (tabs) as default route
// and bypassing all authentication logic. Initial route is now app/index.tsx

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { isAuthenticated, isLoading, logout } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Dev-only: Force logout on startup if flag is set
  useEffect(() => {
    if (__DEV__ && process.env.EXPO_PUBLIC_FORCE_LOGOUT === "1") {
      console.log('[_layout.tsx] EXPO_PUBLIC_FORCE_LOGOUT=1 detected, forcing logout...');
      logout();
    }
  }, []);

  useEffect(() => {
    if (isLoading) return;

    // Check if we're in an auth route (login or register)
    const inAuthGroup = segments[0] === 'login' || segments[0] === 'register';

    if (__DEV__) {
      console.log('[_layout.tsx] Auth Guard Check:');
      console.log('  - segments:', segments);
      console.log('  - isAuthenticated:', isAuthenticated);
      console.log('  - inAuthGroup:', inAuthGroup);
      console.log('  - isLoading:', isLoading);
    }

    // CRITICAL: Redirect unauthenticated users away from protected routes
    if (!isAuthenticated && !inAuthGroup) {
      if (__DEV__) {
        console.log('[_layout.tsx] ❌ Not authenticated, redirecting to /login');
      }
      router.replace('/login');
    }
    // Redirect authenticated users away from auth screens
    else if (isAuthenticated && inAuthGroup) {
      if (__DEV__) {
        console.log('[_layout.tsx] ✅ Authenticated, redirecting to /(tabs)/hotspots');
      }
      router.replace('/(tabs)/hotspots');
    }
  }, [isAuthenticated, segments, isLoading]);

  // Show loading screen while checking auth
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0b3d91" />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Slot />
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
