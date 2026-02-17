import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Button,
  FlatList,
  StyleSheet,
  Alert,
  Platform,
  Pressable,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { API_BASE } from "../../../src/config";

type Contact = {
  id: number;
  contacted_at: string;
  outcome: string;
  note?: string | null;
};

type NearestHotspot = null | {
  id: number;
  grid_lat: number;
  grid_lon: number;
  risk_score: number;
  recent_count: number;
  baseline_count: number;
};

type Client = {
  id: number;
  display_name: string;
  neighborhood?: string | null;
  notes?: string | null;
  created_at: string;

  follow_up_at?: string | null;

  need_housing: boolean;
  need_food: boolean;
  need_therapy: boolean;
  need_job: boolean;
  need_transport: boolean;

  home_lat?: number | null;
  home_lon?: number | null;
};

export default function ClientDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const clientId = Number(id);

  const [client, setClient] = useState<Client | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [saving, setSaving] = useState(false);

  // Follow-up picker state
  const [showPicker, setShowPicker] = useState(false);
  const [followUpDate, setFollowUpDate] = useState<Date | null>(null);

  // Area context
  const [nearest, setNearest] = useState<NearestHotspot>(null);

  const needs = useMemo(() => {
    if (!client) return [];
    return [
      { key: "need_housing" as const, label: "Housing", value: client.need_housing },
      { key: "need_food" as const, label: "Food", value: client.need_food },
      { key: "need_therapy" as const, label: "Therapy", value: client.need_therapy },
      { key: "need_job" as const, label: "Job", value: client.need_job },
      { key: "need_transport" as const, label: "Transport", value: client.need_transport },
    ];
  }, [client]);

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/triage/clients/${clientId}`);
      const data = await res.json();
      setClient(data.client);
      setContacts(data.contacts || []);

      const iso = data.client?.follow_up_at;
      setFollowUpDate(iso ? new Date(iso) : null);

      // Context (nearest hotspot)
      const ctxRes = await fetch(`${API_BASE}/triage/clients/${clientId}/context`);
      const ctx = await ctxRes.json();
      setNearest(ctx.nearest_hotspot ?? null);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to load client");
    }
  };

  const logContact = async (outcome: string, note: string) => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/triage/clients/${clientId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, note }),
      });
      if (!res.ok) throw new Error("Failed to log contact");
      await load();
      Alert.alert("Success", "Contact logged");
    } catch (e: any) {
      Alert.alert("Log Error", e?.message || "Failed to log contact");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    load();
  }, [clientId]);

  const toggleNeed = (key: keyof Client) => {
    if (!client) return;
    setClient({ ...client, [key]: !client[key] } as Client);
  };

  const savePlan = async () => {
    if (!client) return;

    setSaving(true);
    try {
      const payload = {
        // send ISO without timezone "YYYY-MM-DDTHH:MM:SS"
        follow_up_at: followUpDate ? followUpDate.toISOString().slice(0, 19) : null,

        need_housing: client.need_housing,
        need_food: client.need_food,
        need_therapy: client.need_therapy,
        need_job: client.need_job,
        need_transport: client.need_transport,
      };

      const res = await fetch(`${API_BASE}/triage/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!data?.client?.id) throw new Error("Save failed");

      setClient(data.client);
      const iso = data.client?.follow_up_at;
      setFollowUpDate(iso ? new Date(iso) : null);

      Alert.alert("Saved", "Plan updated");
      await load(); // refresh context too
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not save plan");
    } finally {
      setSaving(false);
    }
  };

  const renderHeader = () => (
    <>
      <Text style={styles.title}>{client?.display_name || "Client"}</Text>
      {client?.neighborhood ? <Text style={styles.sub}>📍 {client.neighborhood}</Text> : null}
      {client?.notes ? <Text style={styles.notes}>{client.notes}</Text> : null}

      <View style={styles.quickActions}>
        <Pressable
          style={styles.quickBtn}
          onPress={() => logContact("reached", "Quick log from detail")}
          disabled={saving}
        >
          <Text style={styles.quickBtnText}>Log Reached</Text>
        </Pressable>

        <Pressable
          style={[styles.quickBtn, styles.quickBtnAlt]}
          onPress={() => logContact("no_answer", "No answer")}
          disabled={saving}
        >
          <Text style={styles.quickBtnText}>No Answer</Text>
        </Pressable>
      </View>

      <View style={{ gap: 10 }}>
        <Button title="Log Contact" onPress={() => router.push(`/(tabs)/triage/${clientId}/log`)} />
        <Button title={saving ? "Saving..." : "Save Plan"} onPress={savePlan} disabled={saving} />
      </View>

      <Text style={styles.section}>Plan</Text>
      <Text style={styles.label}>Follow-up</Text>

      <View style={{ flexDirection: "row", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Text style={styles.followText}>
          {followUpDate ? followUpDate.toLocaleString() : "None set"}
        </Text>
        <Button title="Pick" onPress={() => setShowPicker(true)} />
        <Button title="Clear" onPress={() => setFollowUpDate(null)} />
      </View>

      <View style={{ flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <Button title="Today" onPress={() => setFollowUpDate(new Date())} />
        <Button
          title="Tomorrow"
          onPress={() => {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            setFollowUpDate(d);
          }}
        />
        <Button
          title="+3 Days"
          onPress={() => {
            const d = new Date();
            d.setDate(d.getDate() + 3);
            setFollowUpDate(d);
          }}
        />
      </View>

      {showPicker && (
        <DateTimePicker
          value={followUpDate ?? new Date()}
          mode="datetime"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(event, selected) => {
            if (Platform.OS !== "ios") setShowPicker(false);
            if (selected) setFollowUpDate(selected);
          }}
        />
      )}

      {Platform.OS === "ios" && showPicker && (
        <View style={{ marginTop: 10 }}>
          <Button title="Done" onPress={() => setShowPicker(false)} />
        </View>
      )}

      <Text style={styles.section}>Needs</Text>
      <View style={styles.pills}>
        {needs.map((n) => (
          <Text
            key={n.key}
            onPress={() => toggleNeed(n.key)}
            style={[styles.pill, n.value && styles.pillActive]}
          >
            {n.label}
          </Text>
        ))}
      </View>

      <Text style={styles.section}>Area Context</Text>
      {nearest ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Nearest Hotspot Risk: {nearest.risk_score}</Text>
          <Text style={styles.cardText}>
            Recent: {nearest.recent_count} | Baseline: {nearest.baseline_count}
          </Text>
          <Text style={styles.cardSub}>
            Cell: {nearest.grid_lat.toFixed(4)}, {nearest.grid_lon.toFixed(4)}
          </Text>
        </View>
      ) : (
        <Text style={{ color: "#aaa" }}>
          No location set for this client yet (or no hotspots computed).
        </Text>
      )}

      <Text style={styles.section}>Contact History</Text>
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <FlatList
        data={contacts}
        keyExtractor={(i) => String(i.id)}
        ListHeaderComponent={renderHeader}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.outcome.toUpperCase()}</Text>
            <Text style={styles.cardText}>{new Date(item.contacted_at).toLocaleString()}</Text>
            {!!item.note && <Text style={styles.cardText}>{item.note}</Text>}
          </View>
        )}
        ListEmptyComponent={<Text style={{ color: "#aaa", marginTop: 10 }}>No contacts logged yet.</Text>}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 10 },
  title: { fontSize: 26, fontWeight: "800", color: "white" },
  sub: { color: "#9aa0a6" },
  notes: {
    color: "#dcdcdc",
    backgroundColor: "#111",
    borderColor: "#2a2a2a",
    borderWidth: 1,
    padding: 12,
    borderRadius: 10,
  },
  section: { color: "white", fontWeight: "800", marginTop: 10, fontSize: 16 },
  label: { color: "white", fontWeight: "700" },

  listContent: {
    padding: 20,
    gap: 10,
    paddingBottom: 100, // Extra padding for iOS tab bar
  },

  quickActions: { flexDirection: "row", gap: 10, marginTop: 10 },
  quickBtn: {
    flex: 1,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1f2937",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  quickBtnAlt: { backgroundColor: "#0b3d91", borderColor: "#1d4ed8" },
  quickBtnText: { color: "#fff", fontWeight: "900" },

  followText: {
    color: "white",
    backgroundColor: "#111",
    borderColor: "#2a2a2a",
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },

  pills: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6 },
  pill: {
    color: "#cfcfcf",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    backgroundColor: "#111",
  },
  pillActive: { color: "white", borderColor: "#5b8cff" },

  card: { backgroundColor: "#111", borderColor: "#2a2a2a", borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10 },
  cardTitle: { color: "white", fontWeight: "800" },
  cardText: { color: "#cfcfcf", marginTop: 4 },
  cardSub: { marginTop: 6, color: "#9aa0a6", fontSize: 12 },
});
