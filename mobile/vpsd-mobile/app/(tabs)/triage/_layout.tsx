import React from "react";
import { Stack } from "expo-router";

export default function TriageLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Triage Queue" }} />
      <Stack.Screen name="add" options={{ title: "Add Client" }} />
      <Stack.Screen name="[id]" options={{ title: "Client" }} />
      <Stack.Screen name="[id]/log" options={{ title: "Log Contact" }} />
    </Stack>
  );
}