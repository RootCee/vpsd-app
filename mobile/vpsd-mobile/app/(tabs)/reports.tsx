import React, { useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { authenticatedFetch, getErrorMessage, parseApiResponse } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";

type Severity = "low" | "medium" | "high";

type SharedUser = {
  id: number;
  name: string | null;
  email: string | null;
};

type SharedGroup = {
  id: number;
  name: string;
};

type UserItem = {
  id: number;
  name: string | null;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
};

type GroupItem = {
  id: number;
  name: string;
  description?: string | null;
  created_by_user_id: number;
  created_at: string;
  members: SharedUser[];
};

type FieldReport = {
  id: number;
  sender_user_id: number;
  sender_name?: string | null;
  sender_email?: string | null;
  title: string;
  message: string;
  location_text?: string | null;
  severity?: Severity | null;
  status: string;
  published_to_all?: boolean;
  published_by_user_id?: number | null;
  visibility?: "private" | "shared" | "published";
  shared_with_users?: SharedUser[];
  shared_with_groups?: SharedGroup[];
  created_at: string;
  published_at?: string | null;
};

export default function ReportsScreen() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isPolice = user?.role === "police";

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [locationText, setLocationText] = useState("");
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [reports, setReports] = useState<FieldReport[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [sharingReport, setSharingReport] = useState<FieldReport | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingInbox, setLoadingInbox] = useState(false);

  const resetForm = () => {
    setTitle("");
    setMessage("");
    setLocationText("");
    setSeverity(null);
  };

  const loadReports = async () => {
    const res = await authenticatedFetch(isAdmin ? "/field-reports/inbox" : "/field-reports");
    const data = await parseApiResponse<{ reports?: FieldReport[] }>(res, "Unable to load field reports.");
    setReports(Array.isArray(data.reports) ? data.reports : []);
  };

  const loadShareTargets = async () => {
    if (!isAdmin) return;

    const [usersRes, groupsRes] = await Promise.all([
      authenticatedFetch("/auth/users"),
      authenticatedFetch("/groups"),
    ]);
    const usersData = await parseApiResponse<{ users?: UserItem[] }>(usersRes, "Unable to load users.");
    const groupsData = await parseApiResponse<{ groups?: GroupItem[] }>(groupsRes, "Unable to load groups.");
    setUsers(Array.isArray(usersData.users) ? usersData.users : []);
    setGroups(Array.isArray(groupsData.groups) ? groupsData.groups : []);
  };

  const refreshAll = async () => {
    setLoadingInbox(true);
    try {
      await loadReports();
      if (isAdmin) {
        await loadShareTargets();
      }
    } catch (e: any) {
      Alert.alert("Reports Unavailable", getErrorMessage(e, "Please try again."));
    } finally {
      setLoadingInbox(false);
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      void refreshAll();
    }, [isAdmin])
  );

  const submitReport = async () => {
    const trimmedTitle = title.trim();
    const trimmedMessage = message.trim();

    if (!trimmedTitle || !trimmedMessage) {
      Alert.alert("Missing Info", "Please enter both a title and message.");
      return;
    }

    setSaving(true);
    try {
      const res = await authenticatedFetch("/field-reports", {
        method: "POST",
        body: JSON.stringify({
          title: trimmedTitle,
          message: trimmedMessage,
          location_text: locationText.trim() || null,
          severity,
        }),
      });
      await parseApiResponse(res, "Unable to send this field report.");
      resetForm();
      Alert.alert("Sent", "Your field report was sent to admin.");
      await refreshAll();
    } catch (e: any) {
      Alert.alert("Send Failed", getErrorMessage(e, "Please try again."));
    } finally {
      setSaving(false);
    }
  };

  const markReviewed = async (reportId: number) => {
    setLoadingInbox(true);
    try {
      const res = await authenticatedFetch(`/field-reports/${reportId}/mark-reviewed`, {
        method: "POST",
      });
      await parseApiResponse(res, "Unable to update this field report.");
      await refreshAll();
    } catch (e: any) {
      Alert.alert("Update Failed", getErrorMessage(e, "Please try again."));
      setLoadingInbox(false);
    }
  };

  const publishReport = async (reportId: number) => {
    Alert.alert("Publish Report", "Send this report to all users?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Publish",
        onPress: async () => {
          setLoadingInbox(true);
          try {
            const res = await authenticatedFetch(`/field-reports/${reportId}/publish`, {
              method: "POST",
            });
            await parseApiResponse(res, "Unable to publish this report.");
            await refreshAll();
          } catch (e: any) {
            Alert.alert("Publish Failed", getErrorMessage(e, "Please try again."));
            setLoadingInbox(false);
          }
        },
      },
    ]);
  };

  const deleteReport = async (reportId: number) => {
    Alert.alert("Delete Report", "Delete this field report? This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setLoadingInbox(true);
          try {
            const res = await authenticatedFetch(`/field-reports/${reportId}`, {
              method: "DELETE",
            });
            await parseApiResponse(res, "Unable to delete this field report.");
            await refreshAll();
          } catch (e: any) {
            Alert.alert("Delete Failed", getErrorMessage(e, "Please try again."));
            setLoadingInbox(false);
          }
        },
      },
    ]);
  };

  const openShareModal = (report: FieldReport) => {
    setSharingReport(report);
    setSelectedUserIds((report.shared_with_users || []).map((item) => item.id));
    setSelectedGroupIds((report.shared_with_groups || []).map((item) => item.id));
  };

  const toggleId = (value: number, current: number[], setCurrent: (next: number[]) => void) => {
    setCurrent(current.includes(value) ? current.filter((id) => id !== value) : [...current, value]);
  };

  const saveShareTargets = async () => {
    if (!sharingReport) return;
    if (!selectedUserIds.length && !selectedGroupIds.length) {
      Alert.alert("Nothing Selected", "Choose at least one user or group.");
      return;
    }

    setSaving(true);
    try {
      const res = await authenticatedFetch(`/field-reports/${sharingReport.id}/share`, {
        method: "POST",
        body: JSON.stringify({
          user_ids: selectedUserIds,
          group_ids: selectedGroupIds,
        }),
      });
      await parseApiResponse(res, "Unable to share this report.");
      setSharingReport(null);
      await refreshAll();
    } catch (e: any) {
      Alert.alert("Share Failed", getErrorMessage(e, "Please try again."));
    } finally {
      setSaving(false);
    }
  };

  const getVisibilityLabel = (item: FieldReport) => {
    if (item.published_to_all || item.visibility === "published") return "Published";
    if ((item.shared_with_users || []).length || (item.shared_with_groups || []).length || item.visibility === "shared") {
      return "Shared";
    }
    return "Private";
  };

  const getShareSummary = (item: FieldReport) => {
    const usersCount = (item.shared_with_users || []).length;
    const groupsCount = (item.shared_with_groups || []).length;
    if (!usersCount && !groupsCount) return null;

    const parts = [];
    if (usersCount) parts.push(`${usersCount} user${usersCount === 1 ? "" : "s"}`);
    if (groupsCount) parts.push(`${groupsCount} group${groupsCount === 1 ? "" : "s"}`);
    return `Shared with ${parts.join(" and ")}`;
  };

  return (
    <>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Field Reports</Text>
        <Text style={styles.helper}>Field Reports are internal messages only. For emergencies, call 911.</Text>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Send Report</Text>

          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Suspicious activity near outreach site"
            placeholderTextColor="#666"
          />

          <Text style={styles.label}>Message</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={message}
            onChangeText={setMessage}
            placeholder="Share what happened and any follow-up needed."
            placeholderTextColor="#666"
            multiline
          />

          <Text style={styles.label}>Location (optional)</Text>
          <TextInput
            style={styles.input}
            value={locationText}
            onChangeText={setLocationText}
            placeholder="Broadway and 14th"
            placeholderTextColor="#666"
          />

          <Text style={styles.label}>Severity (optional)</Text>
          <View style={styles.severityRow}>
            {(["low", "medium", "high"] as Severity[]).map((level) => (
              <Pressable
                key={level}
                style={[styles.severityBtn, severity === level ? styles.severityBtnActive : null]}
                onPress={() => setSeverity(level)}
              >
                <Text style={styles.severityBtnText}>{level}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable style={[styles.submitBtn, saving ? styles.submitBtnDisabled : null]} onPress={submitReport} disabled={saving}>
            <Text style={styles.submitBtnText}>{saving ? "Sending..." : "Send Report"}</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <View style={styles.inboxHeader}>
            <Text style={styles.sectionTitle}>{isAdmin ? "Inbox" : isPolice ? "My, Shared & Published Reports" : "Shared & Published Reports"}</Text>
            <Pressable style={styles.refreshBtn} onPress={refreshAll} disabled={loadingInbox}>
              <Text style={styles.refreshBtnText}>{loadingInbox ? "..." : "Refresh"}</Text>
            </Pressable>
          </View>

          <FlatList
            data={reports}
            keyExtractor={(item) => String(item.id)}
            scrollEnabled={false}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={<Text style={styles.helper}>No field reports yet.</Text>}
            renderItem={({ item }) => (
              <View style={styles.reportCard}>
                <View style={styles.reportHeader}>
                  <Text style={styles.reportTitle}>{item.title}</Text>
                  <Text style={[styles.statusPill, item.status === "reviewed" ? styles.statusReviewed : styles.statusNew]}>
                    {item.status}
                  </Text>
                </View>
                <Text
                  style={
                    getVisibilityLabel(item) === "Published"
                      ? styles.visibilityPublished
                      : getVisibilityLabel(item) === "Shared"
                        ? styles.visibilityShared
                        : styles.visibilityPrivate
                  }
                >
                  {getVisibilityLabel(item)}
                </Text>
                <Text style={styles.reportMeta}>
                  {item.sender_name || "Unnamed User"} • {item.sender_email || "Unknown"}
                </Text>
                <Text style={styles.reportMeta}>{new Date(item.created_at).toLocaleString()}</Text>
                {item.severity ? <Text style={styles.reportMeta}>Severity: {item.severity}</Text> : null}
                {item.location_text ? <Text style={styles.reportMeta}>Location: {item.location_text}</Text> : null}
                {getShareSummary(item) ? <Text style={styles.reportMeta}>{getShareSummary(item)}</Text> : null}
                {(item.shared_with_groups || []).length ? (
                  <Text style={styles.reportMeta}>
                    Groups: {(item.shared_with_groups || []).map((group) => group.name).join(", ")}
                  </Text>
                ) : null}
                {(item.shared_with_users || []).length ? (
                  <Text style={styles.reportMeta}>
                    Users: {(item.shared_with_users || []).map((person) => person.name || person.email || `User ${person.id}`).join(", ")}
                  </Text>
                ) : null}
                <Text style={styles.reportMessage}>{item.message}</Text>

                {isAdmin ? (
                  <View style={styles.reportActions}>
                    {item.status !== "reviewed" ? (
                      <Pressable style={styles.reviewBtn} onPress={() => markReviewed(item.id)} disabled={loadingInbox}>
                        <Text style={styles.reviewBtnText}>Mark Reviewed</Text>
                      </Pressable>
                    ) : null}
                    {!item.published_to_all ? (
                      <Pressable style={styles.publishBtn} onPress={() => publishReport(item.id)} disabled={loadingInbox}>
                        <Text style={styles.publishBtnText}>Publish</Text>
                      </Pressable>
                    ) : null}
                    <Pressable style={styles.shareBtn} onPress={() => openShareModal(item)} disabled={loadingInbox}>
                      <Text style={styles.shareBtnText}>Share</Text>
                    </Pressable>
                    <Pressable style={styles.deleteBtn} onPress={() => deleteReport(item.id)} disabled={loadingInbox}>
                      <Text style={styles.deleteBtnText}>Delete</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            )}
          />
        </View>
      </ScrollView>

      <Modal visible={!!sharingReport} animationType="slide" transparent onRequestClose={() => setSharingReport(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>Share Report</Text>
            <Text style={styles.helper}>{sharingReport?.title || "Select who should receive this report."}</Text>

            <Text style={styles.label}>Users</Text>
            <ScrollView style={styles.modalList}>
              {users.map((item) => {
                const checked = selectedUserIds.includes(item.id);
                return (
                  <Pressable
                    key={`share-user-${item.id}`}
                    style={[styles.shareTargetRow, checked ? styles.shareTargetRowActive : null]}
                    onPress={() => toggleId(item.id, selectedUserIds, setSelectedUserIds)}
                  >
                    <Text style={styles.shareTargetText}>{item.name || item.email}</Text>
                    <Text style={styles.shareTargetMeta}>{checked ? "Selected" : item.email}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={styles.label}>Groups</Text>
            <ScrollView style={styles.modalList}>
              {groups.map((group) => {
                const checked = selectedGroupIds.includes(group.id);
                return (
                  <Pressable
                    key={`share-group-${group.id}`}
                    style={[styles.shareTargetRow, checked ? styles.shareTargetRowActive : null]}
                    onPress={() => toggleId(group.id, selectedGroupIds, setSelectedGroupIds)}
                  >
                    <Text style={styles.shareTargetText}>{group.name}</Text>
                    <Text style={styles.shareTargetMeta}>{checked ? "Selected" : `${group.members.length} members`}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={() => setSharingReport(null)} disabled={saving}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalSaveBtn} onPress={saveShareTargets} disabled={saving}>
                <Text style={styles.modalSaveText}>{saving ? "Saving..." : "Save Share"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
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
  textarea: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  severityRow: {
    flexDirection: "row",
    gap: 10,
  },
  severityBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    backgroundColor: "#111",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  severityBtnActive: {
    backgroundColor: "#0b3d91",
    borderColor: "#0b3d91",
  },
  severityBtnText: {
    color: "#fff",
    fontWeight: "800",
    textTransform: "capitalize",
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
  inboxHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
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
  reportCard: {
    backgroundColor: "#111",
    borderColor: "#232323",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  reportHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  reportTitle: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 16,
    flex: 1,
  },
  statusPill: {
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  statusNew: {
    color: "#fde68a",
    backgroundColor: "#713f12",
  },
  statusReviewed: {
    color: "#dcfce7",
    backgroundColor: "#166534",
  },
  reportMeta: {
    color: "#9aa0a6",
    fontSize: 12,
  },
  visibilityPrivate: {
    color: "#fde68a",
    fontSize: 12,
    fontWeight: "800",
  },
  visibilityShared: {
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: "800",
  },
  visibilityPublished: {
    color: "#86efac",
    fontSize: 12,
    fontWeight: "800",
  },
  reportMessage: {
    color: "#e5e7eb",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  reportActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 6,
    flexWrap: "wrap",
  },
  reviewBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#1d4ed8",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  reviewBtnText: {
    color: "#fff",
    fontWeight: "800",
  },
  publishBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#166534",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  publishBtnText: {
    color: "#fff",
    fontWeight: "800",
  },
  shareBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#7c3aed",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  shareBtnText: {
    color: "#fff",
    fontWeight: "800",
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#0f0f0f",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#202020",
    padding: 16,
    gap: 12,
    maxHeight: "85%",
  },
  modalList: {
    maxHeight: 160,
  },
  shareTargetRow: {
    backgroundColor: "#111",
    borderColor: "#232323",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  shareTargetRowActive: {
    borderColor: "#0b3d91",
    backgroundColor: "#102347",
  },
  shareTargetText: {
    color: "#fff",
    fontWeight: "800",
  },
  shareTargetMeta: {
    color: "#9aa0a6",
    fontSize: 12,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 8,
  },
  modalCancelBtn: {
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  modalCancelText: {
    color: "#fff",
    fontWeight: "700",
  },
  modalSaveBtn: {
    backgroundColor: "#0b3d91",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  modalSaveText: {
    color: "#fff",
    fontWeight: "800",
  },
});
