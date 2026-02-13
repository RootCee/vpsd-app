import React, { useState } from "react";
import { View, Text, Button, TextInput, StyleSheet, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { API_BASE } from "../../../../src/config";

export default function LogContact() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const clientId = Number(id);

  const [outcome, setOutcome] = useState<"reached" | "no_answer" | "referral" | "other">("reached");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/triage/clients/${clientId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, note }),
      });
      const data = await res.json();
      if (!data?.contact?.id) throw new Error("Failed to log contact");

      router.replace(`/(tabs)/triage/${clientId}`);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not log contact");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <View style={styles.container}>
        <Text style={styles.title}>Log Contact</Text>

        <Text style={styles.label}>Outcome</Text>
        <View style={styles.pills}>
          {(["reached","no_answer","referral","other"] as const).map((k) => (
            <Text
              key={k}
              onPress={() => setOutcome(k)}
              style={[styles.pill, outcome === k && styles.pillActive]}
            >
              {k}
            </Text>
          ))}
        </View>

        <Text style={styles.label}>Note (optional)</Text>
        <TextInput
          style={[styles.input, { height: 120 }]}
          value={note}
          onChangeText={setNote}
          multiline
          placeholder="What happened? Next step?"
          placeholderTextColor="#666"
        />

        <Button title={saving ? "Saving..." : "Save"} onPress={save} disabled={saving} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 12 },
  title: { color: "white", fontSize: 24, fontWeight: "800" },
  label: { color: "white", fontWeight: "700" },
  input: { borderWidth: 1, borderColor: "#2a2a2a", borderRadius: 10, padding: 12, color: "white", backgroundColor: "#111" },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  pill: { color: "#cfcfcf", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: "#2a2a2a", backgroundColor: "#111" },
  pillActive: { color: "white", borderColor: "#5b8cff" },
});