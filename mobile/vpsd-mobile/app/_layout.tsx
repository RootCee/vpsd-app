import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { type Href, Slot, useRouter, useSegments } from 'expo-router';
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
  const { isAuthenticated, isLoading, mustResetPassword, logout } = useAuth();
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

    const currentSegment = segments[0] as string | undefined;
    const onLogin = currentSegment === 'login';
    const onChangePassword = currentSegment === 'change-password';

    if (__DEV__) {
      console.log('[_layout.tsx] Auth Guard Check:');
      console.log('  - segments:', segments);
      console.log('  - isAuthenticated:', isAuthenticated);
      console.log('  - mustResetPassword:', mustResetPassword);
      console.log('  - onLogin:', onLogin);
      console.log('  - onChangePassword:', onChangePassword);
      console.log('  - isLoading:', isLoading);
    }

    // CRITICAL: Redirect unauthenticated users away from protected routes
    if (!isAuthenticated && !onLogin) {
      if (__DEV__) {
        console.log('[_layout.tsx] ❌ Not authenticated, redirecting to /login');
      }
      router.replace('/login' as Href);
    }
    else if (isAuthenticated && mustResetPassword && !onChangePassword) {
      if (__DEV__) {
        console.log('[_layout.tsx] 🔐 Password reset required, redirecting to /change-password');
      }
      router.replace('/change-password' as Href);
    }
    // Redirect authenticated users away from auth screens
    else if (isAuthenticated && !mustResetPassword && (onLogin || onChangePassword)) {
      if (__DEV__) {
        console.log('[_layout.tsx] ✅ Authenticated, redirecting to /(tabs)/hotspots');
      }
      router.replace('/(tabs)/hotspots' as Href);
    }
  }, [isAuthenticated, mustResetPassword, segments, isLoading]);

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
