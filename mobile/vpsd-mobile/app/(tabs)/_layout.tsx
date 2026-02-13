import React from "react";
import { Tabs } from "expo-router";

export default function TabLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="hotspots" options={{ title: "Hotspots" }} />
      <Tabs.Screen name="triage" options={{ title: "Triage" }} />
      <Tabs.Screen name="screening" options={{ title: "Screening" }} />
    </Tabs>
  );
}
