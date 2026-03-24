import React, { useState } from "react";
import { View, Text, TextInput, Button, StyleSheet, Alert } from "react-native";
import { authenticatedFetch, getErrorMessage, parseApiResponse } from "../../src/api/client";

export default function Screening() {
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<any>(null);

  async function submit() {
    try {
      const res = await authenticatedFetch("/screening/submit", {
        method: "POST",
        body: JSON.stringify({ notes }),
      });
      const data = await parseApiResponse<any>(res, "Unable to submit screening.");
      setResult(data);
    } catch (error) {
      Alert.alert("Submission Failed", getErrorMessage(error, "Please try again."));
    }
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
