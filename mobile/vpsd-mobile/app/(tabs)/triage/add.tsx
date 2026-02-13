import React, { useState } from "react";
import { View, Text, TextInput, Button, StyleSheet, Alert } from "react-native";
import { useRouter } from "expo-router";
import { API_BASE } from "../../../src/config";

export default function AddClient() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const name = displayName.trim();
    if (!name) return Alert.alert("Missing", "Please enter a name/alias");

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/triage/clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: name, neighborhood, notes }),
      });

      const data = await res.json();
      const id = data?.client?.id;
      if (!id) throw new Error("Failed to create client");

      router.replace(`/(tabs)/triage/${id}`);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not save client");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <View style={styles.container}>
        <Text style={styles.label}>Name / Alias</Text>
        <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="Client A" placeholderTextColor="#666" />

        <Text style={styles.label}>Neighborhood (optional)</Text>
        <TextInput style={styles.input} value={neighborhood} onChangeText={setNeighborhood} placeholder="Southeast SD" placeholderTextColor="#666" />

        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput style={[styles.input, { height: 120 }]} value={notes} onChangeText={setNotes} multiline placeholder="Context, needs, safety flags..." placeholderTextColor="#666" />

        <Button title={saving ? "Saving..." : "Save Client"} onPress={save} disabled={saving} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 12 },
  label: { color: "white", fontWeight: "700" },
  input: { borderWidth: 1, borderColor: "#2a2a2a", borderRadius: 10, padding: 12, color: "white", backgroundColor: "#111" },
});