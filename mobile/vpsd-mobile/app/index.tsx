import { Redirect } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "../src/auth/AuthContext";

export default function Index() {
  const { isAuthenticated, isLoading } = useAuth();

  if (__DEV__) {
    console.log("[index.tsx] Root Index Render:");
    console.log("  - isAuthenticated:", isAuthenticated);
    console.log("  - isLoading:", isLoading);
  }

  // Show loading screen while checking auth
  if (isLoading) {
    if (__DEV__) {
      console.log("[index.tsx] Showing loading screen...");
    }
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#000" }}>
        <ActivityIndicator size="large" color="#0b3d91" />
      </View>
    );
  }

  // Redirect based on authentication status
  const destination = isAuthenticated ? "/(tabs)/hotspots" : "/login";
  if (__DEV__) {
    console.log("[index.tsx] Redirecting to:", destination);
  }
  return <Redirect href={destination} />;
}