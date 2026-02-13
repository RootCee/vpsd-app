import React, { useEffect, useState } from "react";
import { View, Text, Button, FlatList, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { API_BASE } from "../../../src/config";

type QueueItem = {
  client_id: number;
  display_name: string;
  neighborhood?: string | null;
  days_since_last: number;
  misses_30d: number;
  urgency_score: number;
  follow_up_at?: string | null;
  needs_count?: number;
};

export default function TriageQueue() {
  const router = useRouter();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/triage/queue`);
      const data = await res.json();
      setItems(data.items || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <View style={styles.container}>
        <View style={styles.rowBetween}>
          <Text style={styles.title}>👥 Triage</Text>
          <Button title="Add" onPress={() => router.push("/(tabs)/triage/add")} />
        </View>

        <Button title={loading ? "Loading..." : "Refresh"} onPress={load} disabled={loading} />

        <FlatList
          data={items}
          keyExtractor={(i) => String(i.client_id)}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 30 }}
          renderItem={({ item }) => {
            const overdue = item.follow_up_at
              ? new Date(item.follow_up_at).getTime() <= Date.now()
              : false;

            return (
              <Pressable
                onPress={() => router.push(`/(tabs)/triage/${item.client_id}`)}
                style={[styles.card, overdue && styles.cardOverdue]}
              >
                <Text style={styles.cardTitle}>
                  {item.display_name}  •  Score {item.urgency_score}
                </Text>

                <Text style={styles.cardText}>
                  {item.neighborhood ? `📍 ${item.neighborhood}  •  ` : ""}
                  Days since: {item.days_since_last}  •  Misses 30d: {item.misses_30d}
                </Text>

                <Text style={styles.cardSub}>
                  Needs: {item.needs_count ?? 0}
                  {item.follow_up_at
                    ? `  •  Follow-up: ${new Date(item.follow_up_at).toLocaleString()}`
                    : ""}
                </Text>

                {overdue && <Text style={styles.overdueText}>⚠️ Overdue follow-up</Text>}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={{ color: "#aaa", marginTop: 20 }}>
              No clients yet. Tap “Add”.
            </Text>
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 12 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 26, fontWeight: "800", color: "white" },

  card: {
    backgroundColor: "#111",
    borderColor: "#2a2a2a",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardOverdue: {
    borderColor: "#ff4d4d",
  },

  cardTitle: { color: "white", fontWeight: "800", fontSize: 16 },
  cardText: { color: "#cfcfcf", marginTop: 6 },
  cardSub: { color: "#9aa0a6", marginTop: 6, fontSize: 12 },
  overdueText: { color: "#ff8080", marginTop: 6, fontSize: 12, fontWeight: "700" },
});
