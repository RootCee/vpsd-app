import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { authenticatedFetch, getErrorMessage, parseApiResponse } from "../src/api/client";
import { useAuth } from "../src/auth/AuthContext";

type User = {
  id: number;
  name: string | null;
  email: string;
  role: string;
  is_active: boolean;
  must_reset_password?: boolean;
};

export default function ChangePasswordScreen() {
  const { completePasswordReset, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!currentPassword.trim() || !newPassword.trim() || !confirmPassword.trim()) {
      Alert.alert("Missing Info", "Please fill out all password fields.");
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert("Password Mismatch", "New password and confirmation must match.");
      return;
    }

    setSaving(true);
    try {
      const res = await authenticatedFetch("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      const data = await parseApiResponse<{ success?: boolean; user?: User | null }>(
        res,
        "Unable to update your password."
      );

      if (!data.user) {
        throw new Error("Password updated but user session was not refreshed.");
      }

      completePasswordReset(data.user);
      Alert.alert("Password Updated", "Your password has been changed.");
    } catch (e: any) {
      Alert.alert("Update Failed", getErrorMessage(e, "Please try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Change Password</Text>
        <Text style={styles.subtitle}>You must change your temporary password before entering the app.</Text>

        <Text style={styles.label}>Current Password</Text>
        <TextInput
          style={styles.input}
          placeholder="Current password"
          placeholderTextColor="#666"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          autoCapitalize="none"
        />

        <Text style={styles.label}>New Password</Text>
        <TextInput
          style={styles.input}
          placeholder="New password"
          placeholderTextColor="#666"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          autoCapitalize="none"
        />

        <Text style={styles.label}>Confirm New Password</Text>
        <TextInput
          style={styles.input}
          placeholder="Confirm new password"
          placeholderTextColor="#666"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoCapitalize="none"
        />

        <Pressable style={[styles.button, saving && styles.buttonDisabled]} onPress={submit} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save Password</Text>}
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={logout} disabled={saving}>
          <Text style={styles.secondaryButtonText}>Sign Out</Text>
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
    fontSize: 30,
    fontWeight: "900",
    color: "#fff",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#9aa0a6",
    textAlign: "center",
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
  secondaryButton: {
    alignItems: "center",
    paddingVertical: 6,
  },
  secondaryButtonText: {
    color: "#9aa0a6",
    fontWeight: "700",
  },
});
