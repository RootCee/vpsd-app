import React, { useState } from "react";
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
import { useFocusEffect } from "@react-navigation/native";

import { authenticatedFetch, getErrorMessage, parseApiResponse } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";

type Severity = "low" | "medium" | "high";

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
  created_at: string;
  published_at?: string | null;
};

export default function ReportsScreen() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [locationText, setLocationText] = useState("");
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [reports, setReports] = useState<FieldReport[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingInbox, setLoadingInbox] = useState(false);

  const resetForm = () => {
    setTitle("");
    setMessage("");
    setLocationText("");
    setSeverity(null);
  };

  const loadReports = async () => {
    setLoadingInbox(true);
    try {
      const res = await authenticatedFetch(isAdmin ? "/field-reports/inbox" : "/field-reports");
      const data = await parseApiResponse<{ reports?: FieldReport[] }>(res, "Unable to load field reports.");
      setReports(Array.isArray(data.reports) ? data.reports : []);
    } catch (e: any) {
      Alert.alert("Inbox Unavailable", getErrorMessage(e, "Please try again."));
    } finally {
      setLoadingInbox(false);
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      void loadReports();
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
      await loadReports();
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
      await loadReports();
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
            await loadReports();
          } catch (e: any) {
            Alert.alert("Publish Failed", getErrorMessage(e, "Please try again."));
            setLoadingInbox(false);
          }
        },
      },
    ]);
  };

  return (
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
          <Text style={styles.sectionTitle}>{isAdmin ? "Inbox" : "Published Reports"}</Text>
          <Pressable style={styles.refreshBtn} onPress={loadReports} disabled={loadingInbox}>
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
              <Text style={item.published_to_all ? styles.visibilityPublished : styles.visibilityPrivate}>
                {item.published_to_all ? "Published" : "Private"}
              </Text>
              <Text style={styles.reportMeta}>
                {item.sender_name || "Unnamed User"} • {item.sender_email || "Unknown"}
              </Text>
              <Text style={styles.reportMeta}>{new Date(item.created_at).toLocaleString()}</Text>
              {item.severity ? <Text style={styles.reportMeta}>Severity: {item.severity}</Text> : null}
              {item.location_text ? <Text style={styles.reportMeta}>Location: {item.location_text}</Text> : null}
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
                </View>
              ) : null}
            </View>
          )}
        />
      </View>
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
});
