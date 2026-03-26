import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { authenticatedFetch, getErrorMessage, parseApiResponse } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";

type UserItem = {
  id: number;
  name: string | null;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
};

type UsersResponse = {
  users: UserItem[];
};

type CreateUserResponse = {
  user?: UserItem;
};

export default function AdminScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    if (!isAdmin) return;

    setLoading(true);
    try {
      const res = await authenticatedFetch("/auth/users");
      const data = await parseApiResponse<UsersResponse>(res, "Unable to load members.");
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (error) {
      Alert.alert("Members Unavailable", getErrorMessage(error, "Please try again."));
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      router.replace("/(tabs)/hotspots");
      return;
    }

    void loadUsers();
  }, [isAdmin, loadUsers, router]);

  const resetForm = () => {
    setName("");
    setEmail("");
    setPassword("");
    setRole("member");
  };

  const createMember = async () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedName || !trimmedEmail || !password.trim()) {
      Alert.alert("Missing Info", "Please enter name, email, and password.");
      return;
    }

    setLoading(true);
    try {
      const res = await authenticatedFetch("/auth/create-user", {
        method: "POST",
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          password,
          role,
        }),
      });

      const data = await parseApiResponse<CreateUserResponse>(res, "Unable to create member.");
      resetForm();
      await loadUsers();
      Alert.alert("Member Created", `${data.user?.email || trimmedEmail} is ready to sign in.`);
    } catch (error) {
      Alert.alert("Create Member Failed", getErrorMessage(error, "Please try again."));
    } finally {
      setLoading(false);
    }
  };

  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Admin</Text>
        <Text style={styles.helper}>Admin access required.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Admin</Text>
      <Text style={styles.helper}>Create approved members manually. Public registration stays disabled.</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Jane Doe"
          placeholderTextColor="#666"
        />

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="member@hopebridge.org"
          placeholderTextColor="#666"
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="At least 6 characters"
          placeholderTextColor="#666"
          secureTextEntry
          autoCapitalize="none"
        />

        <Text style={styles.label}>Role</Text>
        <View style={styles.roleRow}>
          <Pressable
            style={[styles.roleBtn, role === "member" ? styles.roleBtnActive : null]}
            onPress={() => setRole("member")}
          >
            <Text style={styles.roleBtnText}>Member</Text>
          </Pressable>
          <Pressable
            style={[styles.roleBtn, role === "admin" ? styles.roleBtnActive : null]}
            onPress={() => setRole("admin")}
          >
            <Text style={styles.roleBtnText}>Admin</Text>
          </Pressable>
        </View>

        <Pressable style={[styles.submitBtn, loading ? styles.submitBtnDisabled : null]} onPress={createMember} disabled={loading}>
          <Text style={styles.submitBtnText}>{loading ? "Saving..." : "Create Member"}</Text>
        </Pressable>
      </View>

      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Users</Text>
        <Pressable style={styles.refreshBtn} onPress={loadUsers} disabled={loading}>
          <Text style={styles.refreshBtnText}>{loading ? "..." : "Refresh"}</Text>
        </Pressable>
      </View>

      <FlatList
        data={users}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.helper}>No users found yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.userCard}>
            <Text style={styles.userName}>{item.name || "Unnamed User"}</Text>
            <Text style={styles.userMeta}>{item.email}</Text>
            <Text style={styles.userMeta}>
              {item.role} • {item.is_active ? "active" : "inactive"}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#000",
    padding: 20,
    gap: 14,
  },
  title: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "900",
  },
  helper: {
    color: "#9aa0a6",
    fontSize: 14,
  },
  card: {
    backgroundColor: "#0f0f0f",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#202020",
    padding: 16,
    gap: 10,
  },
  label: {
    color: "#fff",
    fontWeight: "700",
  },
  input: {
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 10,
    padding: 12,
    color: "#fff",
    backgroundColor: "#111",
  },
  roleRow: {
    flexDirection: "row",
    gap: 10,
  },
  roleBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    backgroundColor: "#111",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  roleBtnActive: {
    backgroundColor: "#0b3d91",
    borderColor: "#0b3d91",
  },
  roleBtnText: {
    color: "#fff",
    fontWeight: "800",
  },
  submitBtn: {
    backgroundColor: "#0b3d91",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 6,
  },
  submitBtnDisabled: {
    opacity: 0.7,
  },
  submitBtnText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 15,
  },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  listTitle: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 18,
  },
  refreshBtn: {
    backgroundColor: "#151515",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#252525",
  },
  refreshBtnText: {
    color: "#fff",
    fontWeight: "700",
  },
  listContent: {
    paddingBottom: 30,
    gap: 10,
  },
  userCard: {
    backgroundColor: "#0f0f0f",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#202020",
    padding: 14,
    gap: 4,
  },
  userName: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 16,
  },
  userMeta: {
    color: "#9aa0a6",
  },
});
