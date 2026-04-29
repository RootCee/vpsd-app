import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
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

type GroupMemberItem = {
  id: number;
  name: string | null;
  email: string | null;
};

type GroupItem = {
  id: number;
  name: string;
  description?: string | null;
  created_by_user_id: number;
  created_at: string;
  members: GroupMemberItem[];
};

type GroupsResponse = {
  groups: GroupItem[];
};

export default function AdminScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"member" | "police" | "admin">("member");
  const [users, setUsers] = useState<UserItem[]>([]);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    if (!isAdmin) return;

    try {
      const res = await authenticatedFetch("/auth/users");
      const data = await parseApiResponse<UsersResponse>(res, "Unable to load members.");
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (error) {
      Alert.alert("Members Unavailable", getErrorMessage(error, "Please try again."));
    }
  }, [isAdmin]);

  const loadGroups = useCallback(async () => {
    if (!isAdmin) return;

    try {
      const res = await authenticatedFetch("/groups");
      const data = await parseApiResponse<GroupsResponse>(res, "Unable to load groups.");
      const nextGroups = Array.isArray(data.groups) ? data.groups : [];
      setGroups(nextGroups);
      setSelectedGroupId((current) => {
        if (!nextGroups.length) return null;
        if (current && nextGroups.some((group) => group.id === current)) return current;
        return nextGroups[0].id;
      });
    } catch (error) {
      Alert.alert("Groups Unavailable", getErrorMessage(error, "Please try again."));
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      router.replace("/(tabs)/hotspots");
      return;
    }

    setLoading(true);
    Promise.all([loadUsers(), loadGroups()]).finally(() => setLoading(false));
  }, [isAdmin, loadGroups, loadUsers, router]);

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
      Alert.alert("User Created", `${data.user?.email || trimmedEmail} is ready to sign in.`);
    } catch (error) {
      Alert.alert("Create Member Failed", getErrorMessage(error, "Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const createGroup = async () => {
    const trimmedName = groupName.trim();
    if (!trimmedName) {
      Alert.alert("Missing Info", "Please enter a group name.");
      return;
    }

    setLoading(true);
    try {
      const res = await authenticatedFetch("/groups", {
        method: "POST",
        body: JSON.stringify({
          name: trimmedName,
          description: groupDescription.trim() || null,
        }),
      });
      await parseApiResponse(res, "Unable to create group.");
      setGroupName("");
      setGroupDescription("");
      await loadGroups();
    } catch (error) {
      Alert.alert("Create Group Failed", getErrorMessage(error, "Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const addUserToGroup = async (groupId: number, userId: number) => {
    setLoading(true);
    try {
      const res = await authenticatedFetch(`/groups/${groupId}/members`, {
        method: "POST",
        body: JSON.stringify({ user_ids: [userId] }),
      });
      await parseApiResponse(res, "Unable to add this member to the group.");
      await loadGroups();
    } catch (error) {
      Alert.alert("Add Member Failed", getErrorMessage(error, "Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const removeUserFromGroup = async (groupId: number, userId: number) => {
    setLoading(true);
    try {
      const res = await authenticatedFetch(`/groups/${groupId}/members/${userId}`, {
        method: "DELETE",
      });
      await parseApiResponse(res, "Unable to remove this member from the group.");
      await loadGroups();
    } catch (error) {
      Alert.alert("Remove Member Failed", getErrorMessage(error, "Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const deleteUser = async (item: UserItem) => {
    if (item.id === user?.id) {
      Alert.alert("Not Allowed", "You cannot delete your own account.");
      return;
    }

    Alert.alert("Delete User", `Delete ${item.name || item.email}? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setLoading(true);
          try {
            const res = await authenticatedFetch(`/auth/users/${item.id}`, {
              method: "DELETE",
            });
            await parseApiResponse(res, "Unable to delete this user.");
            await Promise.all([loadUsers(), loadGroups()]);
          } catch (error) {
            Alert.alert("Delete User Failed", getErrorMessage(error, "Please try again."));
          } finally {
            setLoading(false);
          }
        },
      },
    ]);
  };

  const deleteGroup = async (group: GroupItem) => {
    Alert.alert("Delete Group", `Delete ${group.name}? This will remove its memberships and report shares.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setLoading(true);
          try {
            const res = await authenticatedFetch(`/groups/${group.id}`, {
              method: "DELETE",
            });
            await parseApiResponse(res, "Unable to delete this group.");
            await loadGroups();
          } catch (error) {
            Alert.alert("Delete Group Failed", getErrorMessage(error, "Please try again."));
          } finally {
            setLoading(false);
          }
        },
      },
    ]);
  };

  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Admin</Text>
        <Text style={styles.helper}>Admin access required.</Text>
      </View>
    );
  }

  const selectedGroup = groups.find((group) => group.id === selectedGroupId) || null;
  const selectedMemberIds = new Set(selectedGroup?.members.map((member) => member.id) || []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Admin</Text>
      <Text style={styles.helper}>Create approved users manually. Public registration stays disabled.</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Create User</Text>
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
          placeholder="Temporary password"
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
            style={[styles.roleBtn, role === "police" ? styles.roleBtnActive : null]}
            onPress={() => setRole("police")}
          >
            <Text style={styles.roleBtnText}>Police</Text>
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
        scrollEnabled={false}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.helper}>No users found yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.userCard}>
            <View style={styles.userRow}>
              <View style={styles.userCopy}>
                <Text style={styles.userName}>{item.name || "Unnamed User"}</Text>
                <Text style={styles.userMeta}>{item.email}</Text>
                <Text style={styles.userMeta}>
                  {item.role} • {item.is_active ? "active" : "inactive"}
                </Text>
              </View>
              {item.id === user?.id ? (
                <Text style={styles.currentUserText}>Current account</Text>
              ) : (
                <Pressable style={styles.deleteBtn} onPress={() => deleteUser(item)} disabled={loading}>
                  <Text style={styles.deleteBtnText}>Delete</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
      />

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Create Group</Text>
        <TextInput
          style={styles.input}
          value={groupName}
          onChangeText={setGroupName}
          placeholder="Neighborhood Outreach"
          placeholderTextColor="#666"
        />
        <TextInput
          style={styles.input}
          value={groupDescription}
          onChangeText={setGroupDescription}
          placeholder="Optional description"
          placeholderTextColor="#666"
        />
        <Pressable style={[styles.submitBtn, loading ? styles.submitBtnDisabled : null]} onPress={createGroup} disabled={loading}>
          <Text style={styles.submitBtnText}>{loading ? "Saving..." : "Create Group"}</Text>
        </Pressable>
      </View>

      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Manage Groups</Text>
        <Pressable style={styles.refreshBtn} onPress={loadGroups} disabled={loading}>
          <Text style={styles.refreshBtnText}>{loading ? "..." : "Refresh"}</Text>
        </Pressable>
      </View>

      {groups.length ? (
        <View style={styles.groupPickerRow}>
          {groups.map((group) => (
            <Pressable
              key={group.id}
              style={[styles.groupPill, selectedGroupId === group.id ? styles.groupPillActive : null]}
              onPress={() => setSelectedGroupId(group.id)}
            >
              <Text style={styles.groupPillText}>{group.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={styles.helper}>No groups created yet.</Text>
      )}

      {selectedGroup ? (
        <View style={styles.card}>
          <View style={styles.groupHeaderRow}>
            <Text style={styles.sectionTitle}>{selectedGroup.name}</Text>
            <Pressable style={styles.deleteBtn} onPress={() => deleteGroup(selectedGroup)} disabled={loading}>
              <Text style={styles.deleteBtnText}>Delete</Text>
            </Pressable>
          </View>
          {selectedGroup.description ? <Text style={styles.helper}>{selectedGroup.description}</Text> : null}

          <Text style={styles.label}>Members</Text>
          {selectedGroup.members.length ? (
            selectedGroup.members.map((member) => (
              <View key={member.id} style={styles.groupMemberRow}>
                <View style={styles.groupMemberCopy}>
                  <Text style={styles.userName}>{member.name || "Unnamed User"}</Text>
                  <Text style={styles.userMeta}>{member.email || "No email"}</Text>
                </View>
                <Pressable
                  style={styles.removeBtn}
                  onPress={() => removeUserFromGroup(selectedGroup.id, member.id)}
                  disabled={loading}
                >
                  <Text style={styles.removeBtnText}>Remove</Text>
                </Pressable>
              </View>
            ))
          ) : (
            <Text style={styles.helper}>No members in this group yet.</Text>
          )}

          <Text style={styles.label}>Add Users</Text>
          {users.map((item) => (
            <View key={`group-user-${item.id}`} style={styles.groupMemberRow}>
              <View style={styles.groupMemberCopy}>
                <Text style={styles.userName}>{item.name || "Unnamed User"}</Text>
                <Text style={styles.userMeta}>{item.email}</Text>
              </View>
              <Pressable
                style={[styles.addBtn, selectedMemberIds.has(item.id) ? styles.addBtnDisabled : null]}
                onPress={() => addUserToGroup(selectedGroup.id, item.id)}
                disabled={loading || selectedMemberIds.has(item.id)}
              >
                <Text style={styles.addBtnText}>{selectedMemberIds.has(item.id) ? "Added" : "Add"}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#000",
  },
  content: {
    padding: 20,
    gap: 14,
    paddingBottom: 40,
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
  sectionTitle: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 18,
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
  userRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  userCopy: {
    flex: 1,
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
  currentUserText: {
    color: "#9aa0a6",
    fontSize: 12,
    fontWeight: "700",
  },
  deleteBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#991b1b",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  deleteBtnText: {
    color: "#fff",
    fontWeight: "800",
  },
  groupPickerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  groupHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  groupPill: {
    borderWidth: 1,
    borderColor: "#2a2a2a",
    backgroundColor: "#111",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  groupPillActive: {
    backgroundColor: "#0b3d91",
    borderColor: "#0b3d91",
  },
  groupPillText: {
    color: "#fff",
    fontWeight: "800",
  },
  groupMemberRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingVertical: 6,
  },
  groupMemberCopy: {
    flex: 1,
    gap: 4,
  },
  addBtn: {
    backgroundColor: "#166534",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addBtnDisabled: {
    opacity: 0.5,
  },
  addBtnText: {
    color: "#fff",
    fontWeight: "800",
  },
  removeBtn: {
    backgroundColor: "#7f1d1d",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  removeBtnText: {
    color: "#fff",
    fontWeight: "800",
  },
});
