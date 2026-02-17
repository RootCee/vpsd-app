import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  ScrollView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { authenticatedFetch, safeJson } from "../../../src/api/client";

type QueueItem = {
  client_id: number;
  display_name: string;
  neighborhood?: string | null;
  days_since_last: number;
  misses_30d: number;
  urgency_score: number;
  follow_up_at?: string | null;
  needs_count: number;
};

type QueueResponse = { items: QueueItem[] };

function parseISO(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function daysFromNow(d: Date) {
  const ms = d.getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function urgencyLabel(score: number) {
  if (score >= 80) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MED";
  return "LOW";
}

function badgeStyle(score: number) {
  if (score >= 80) return styles.badgeCritical;
  if (score >= 50) return styles.badgeHigh;
  if (score >= 25) return styles.badgeMed;
  return styles.badgeLow;
}

export default function Triage() {
  const router = useRouter();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Add Client modal
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [notes, setNotes] = useState("");

  const [needHousing, setNeedHousing] = useState(false);
  const [needFood, setNeedFood] = useState(false);
  const [needTherapy, setNeedTherapy] = useState(false);
  const [needJob, setNeedJob] = useState(false);
  const [needTransport, setNeedTransport] = useState(false);

  const resetForm = () => {
    setName("");
    setNeighborhood("");
    setNotes("");
    setNeedHousing(false);
    setNeedFood(false);
    setNeedTherapy(false);
    setNeedJob(false);
    setNeedTransport(false);
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await authenticatedFetch("/triage/queue");
      const data = await safeJson<QueueResponse>(res);
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e: any) {
      console.log(e?.message || e);
      Alert.alert("Triage Error", e?.message ? String(e.message) : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const addClient = async () => {
    const display_name = name.trim();
    if (!display_name) {
      Alert.alert("Missing name", "Please enter a display name.");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        display_name,
        neighborhood: neighborhood.trim() || null,
        notes: notes.trim() || null,
        need_housing: needHousing,
        need_food: needFood,
        need_therapy: needTherapy,
        need_job: needJob,
        need_transport: needTransport,
      };

      const res = await authenticatedFetch("/triage/clients", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await safeJson(res);

      setShowAdd(false);
      resetForm();
      await refresh();
    } catch (e: any) {
      console.log(e?.message || e);
      Alert.alert("Add Client Error", e?.message ? String(e.message) : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const headerStats = useMemo(() => {
    const total = items.length;
    const high = items.filter((i) => i.urgency_score >= 50).length;
    const critical = items.filter((i) => i.urgency_score >= 80).length;
    const overdue = items.filter((i) => {
      const f = parseISO(i.follow_up_at);
      return f ? daysFromNow(f) <= 0 : false;
    }).length;
    return { total, high, critical, overdue };
  }, [items]);

  const renderItem = ({ item }: { item: QueueItem }) => {
    const follow = parseISO(item.follow_up_at);
    const followDays = follow ? daysFromNow(follow) : null;
    const isOverdue = followDays !== null && followDays <= 0;

    return (
      <Pressable
        style={[styles.card, isOverdue ? styles.cardOverdue : null]}
        onPress={() => router.push(`/(tabs)/triage/${item.client_id}`)}
      >
        <View style={styles.rowBetween}>
          <Text style={styles.name}>{item.display_name}</Text>

          <View style={[styles.badge, badgeStyle(item.urgency_score)]}>
            <Text style={styles.badgeText}>
              {urgencyLabel(item.urgency_score)} • {item.urgency_score}
            </Text>
          </View>
        </View>

        {!!item.neighborhood && <Text style={styles.meta}>📍 {item.neighborhood}</Text>}

        <View style={styles.metaRow}>
          <Text style={styles.meta}>
            Last contact: {item.days_since_last >= 9999 ? "—" : `${item.days_since_last}d ago`}
          </Text>
          <Text style={styles.meta}>No-answer (30d): {item.misses_30d}</Text>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.meta}>Needs: {item.needs_count}</Text>
          {follow ? (
            <Text style={[styles.meta, isOverdue ? styles.overdueText : null]}>
              Follow-up: {isOverdue ? "OVERDUE" : `in ${followDays}d`}
            </Text>
          ) : (
            <Text style={styles.meta}>Follow-up: —</Text>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>👥 Triage</Text>

        <View style={styles.headerRight}>
          <Pressable style={styles.headerBtn} onPress={() => setShowAdd(true)}>
            <Text style={styles.headerBtnText}>Add</Text>
          </Pressable>

          <Pressable style={[styles.headerBtn, styles.headerBtnAlt2]} onPress={refresh}>
            <Text style={styles.headerBtnText}>{loading ? "…" : "Refresh"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statPill}>
          <Text style={styles.statLabel}>Queue</Text>
          <Text style={styles.statValue}>{headerStats.total}</Text>
        </View>
        <View style={styles.statPill}>
          <Text style={styles.statLabel}>High</Text>
          <Text style={styles.statValue}>{headerStats.high}</Text>
        </View>
        <View style={styles.statPill}>
          <Text style={styles.statLabel}>Critical</Text>
          <Text style={styles.statValue}>{headerStats.critical}</Text>
        </View>
        <View style={styles.statPill}>
          <Text style={styles.statLabel}>Overdue</Text>
          <Text style={styles.statValue}>{headerStats.overdue}</Text>
        </View>
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.centerText}>Loading…</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => String(i.client_id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
          renderItem={renderItem}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              No clients yet. Tap “Add” to create your first client.
            </Text>
          }
        />
      )}

      <Modal visible={showAdd} animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Client</Text>
            <Pressable
              onPress={() => {
                setShowAdd(false);
                resetForm();
              }}
            >
              <Text style={styles.modalClose}>Close</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <Text style={styles.label}>Display Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. John D."
              placeholderTextColor="#666"
              style={styles.input}
            />

            <Text style={styles.label}>Neighborhood</Text>
            <TextInput
              value={neighborhood}
              onChangeText={setNeighborhood}
              placeholder="e.g. City Heights"
              placeholderTextColor="#666"
              style={styles.input}
            />

            <Text style={styles.label}>Notes</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Short notes..."
              placeholderTextColor="#666"
              style={[styles.input, { height: 100 }]}
              multiline
            />

            <Text style={[styles.label, { marginTop: 14 }]}>Needs</Text>
            <View style={styles.chipRow}>
              <NeedChip label="Housing" on={needHousing} setOn={setNeedHousing} />
              <NeedChip label="Food" on={needFood} setOn={setNeedFood} />
              <NeedChip label="Therapy" on={needTherapy} setOn={setNeedTherapy} />
              <NeedChip label="Job" on={needJob} setOn={setNeedJob} />
              <NeedChip label="Transport" on={needTransport} setOn={setNeedTransport} />
            </View>

            <Pressable style={styles.saveBtn} onPress={addClient} disabled={loading}>
              <Text style={styles.saveBtnText}>{loading ? "Saving…" : "Create Client"}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function NeedChip({
  label,
  on,
  setOn,
}: {
  label: string;
  on: boolean;
  setOn: (v: boolean) => void;
}) {
  return (
    <Pressable onPress={() => setOn(!on)} style={[styles.chip, on ? styles.chipOn : styles.chipOff]}>
      <Text style={[styles.chipText, on ? styles.chipTextOn : styles.chipTextOff]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },

  header: {
    paddingTop: Platform.OS === "ios" ? 50 : 18,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 26, fontWeight: "900", color: "#fff" },
  headerRight: { flexDirection: "row", gap: 10 },

  headerBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#1f2937",
  },
  headerBtnAlt2: { backgroundColor: "#0b3d91" },
  headerBtnText: { color: "#fff", fontWeight: "800" },

  statsRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  statPill: {
    flex: 1,
    backgroundColor: "#0f0f0f",
    borderWidth: 1,
    borderColor: "#1e1e1e",
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: "center",
  },
  statLabel: { color: "#9aa0a6", fontSize: 12, fontWeight: "700" },
  statValue: { color: "#fff", fontSize: 18, fontWeight: "900", marginTop: 2 },

  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  centerText: { color: "#9aa0a6", marginTop: 10 },
  emptyText: { color: "#9aa0a6", padding: 16, paddingTop: 20 },

  card: {
    backgroundColor: "#0f0f0f",
    borderWidth: 1,
    borderColor: "#202020",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  cardOverdue: { borderColor: "#991b1b" },

  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  name: { color: "#fff", fontSize: 18, fontWeight: "900", flex: 1 },

  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  badgeText: { color: "#fff", fontWeight: "900", fontSize: 12 },

  badgeCritical: { backgroundColor: "#7f1d1d", borderColor: "#991b1b" },
  badgeHigh: { backgroundColor: "#7c2d12", borderColor: "#9a3412" },
  badgeMed: { backgroundColor: "#1f2937", borderColor: "#374151" },
  badgeLow: { backgroundColor: "#0b3d91", borderColor: "#1d4ed8" },

  meta: { color: "#cfcfcf", marginTop: 6, fontWeight: "700" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  overdueText: { color: "#ff6b6b" },

  actionRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  actionBtn: {
    flex: 1,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1f2937",
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
  },
  actionBtnAlt: { backgroundColor: "#0b3d91", borderColor: "#1d4ed8" },
  actionText: { color: "#fff", fontWeight: "900" },

  modal: { flex: 1, backgroundColor: "#000", paddingHorizontal: 16, paddingTop: 60 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { color: "#fff", fontSize: 22, fontWeight: "900" },
  modalClose: { color: "#60a5fa", fontWeight: "900", fontSize: 16 },

  label: { color: "#9aa0a6", fontWeight: "800", marginTop: 10 },
  input: {
    marginTop: 8,
    backgroundColor: "#0f0f0f",
    borderWidth: 1,
    borderColor: "#202020",
    borderRadius: 12,
    padding: 12,
    color: "#fff",
    fontWeight: "700",
  },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  chipOn: { backgroundColor: "#0b3d91", borderColor: "#1d4ed8" },
  chipOff: { backgroundColor: "#0f0f0f", borderColor: "#202020" },
  chipText: { fontWeight: "900" },
  chipTextOn: { color: "#fff" },
  chipTextOff: { color: "#cfcfcf" },

  saveBtn: {
    marginTop: 18,
    backgroundColor: "#16a34a",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontWeight: "900", fontSize: 16 },
});