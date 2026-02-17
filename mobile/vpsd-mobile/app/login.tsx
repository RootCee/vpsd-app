import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../src/auth/AuthContext";

export default function LoginScreen() {
  const router = useRouter();
  const { login, register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [devMenuPresses, setDevMenuPresses] = useState(0);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Error", "Please enter email and password");
      return;
    }

    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      if (__DEV__) {
        console.log("[login.tsx] Login successful");
      }
      // Auth guard in _layout.tsx will handle redirect
    } catch (error: any) {
      if (__DEV__) {
        console.error("[login.tsx] Login failed:", error);
      }
      Alert.alert("Login Failed", error.message || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  const handleDevMenu = () => {
    if (!__DEV__) return;

    const newCount = devMenuPresses + 1;
    setDevMenuPresses(newCount);

    if (newCount >= 3) {
      setDevMenuPresses(0);
      Alert.alert(
        "🔧 Dev Menu",
        "Create a demo user?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Create Demo User",
            onPress: async () => {
              setLoading(true);
              try {
                await register("demo@vpsd.app", "demo123");
                Alert.alert("Success", "Demo user created!\n\nEmail: demo@vpsd.app\nPassword: demo123");
              } catch (error: any) {
                const msg = error.message || "Failed to create demo user";
                // If user already exists, show login option
                if (msg.includes("already registered")) {
                  Alert.alert(
                    "User Exists",
                    "Demo user already exists. Login instead?",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Login",
                        onPress: async () => {
                          setEmail("demo@vpsd.app");
                          setPassword("demo123");
                          try {
                            await login("demo@vpsd.app", "demo123");
                          } catch (err: any) {
                            Alert.alert("Error", err.message || "Login failed");
                          }
                        },
                      },
                    ]
                  );
                } else {
                  Alert.alert("Error", msg);
                }
              } finally {
                setLoading(false);
              }
            },
          },
        ]
      );
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>👤 Login</Text>
        <Pressable onPress={handleDevMenu}>
          <Text style={styles.subtitle}>VPSD App</Text>
        </Pressable>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          placeholder="email@example.com"
          placeholderTextColor="#666"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#666"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
        />

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Login</Text>
          )}
        </Pressable>

        <Pressable
          style={styles.linkButton}
          onPress={() => router.push("/register")}
          disabled={loading}
        >
          <Text style={styles.linkText}>Don't have an account? Register</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#0f0f0f",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#202020",
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: "900",
    color: "#fff",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#9aa0a6",
    textAlign: "center",
    marginBottom: 8,
  },
  label: {
    color: "#9aa0a6",
    fontWeight: "800",
    fontSize: 14,
  },
  input: {
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#202020",
    borderRadius: 12,
    padding: 14,
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  button: {
    backgroundColor: "#0b3d91",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
  },
  linkButton: {
    alignItems: "center",
    paddingVertical: 8,
  },
  linkText: {
    color: "#60a5fa",
    fontWeight: "700",
  },
});
