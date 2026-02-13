import React, { useState } from "react";
import { View, Text, TextInput, Button, StyleSheet } from "react-native";
import { API_BASE } from "../../src/config";

export default function Screening() {
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<any>(null);

  async function submit() {
    const res = await fetch(`${API_BASE}/screening/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    setResult(await res.json());
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>📝 Screening</Text>

      <TextInput
        style={styles.input}
        placeholder="Enter notes..."
        value={notes}
        onChangeText={setNotes}
        multiline
      />

      <Button title="Submit" onPress={submit} />

      {result && (
        <View style={styles.card}>
          <Text style={styles.bold}>Escalate: {String(result.is_escalated)}</Text>
          <Text>Reason: {result.escalation_reason || "None"}</Text>
          <Text>Next: {result.next_steps}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 14 },
  title: { fontSize: 26, fontWeight: "800" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 12, height: 120 },
  card: { padding: 14, borderWidth: 1, borderColor: "#eee", borderRadius: 10 },
  bold: { fontWeight: "800" },
});
