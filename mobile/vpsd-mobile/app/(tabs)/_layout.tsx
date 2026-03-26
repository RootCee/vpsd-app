import React from "react";
import { Tabs } from "expo-router";
import { useAuth } from "../../src/auth/AuthContext";

export default function TabLayout() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <Tabs>
      <Tabs.Screen name="hotspots" options={{ title: "Hotspots" }} />
      <Tabs.Screen name="triage" options={{ title: "Triage" }} />
      <Tabs.Screen name="screening" options={{ title: "Screening" }} />
      <Tabs.Screen
        name="admin"
        options={{ title: "Admin", href: isAdmin ? undefined : null }}
      />
    </Tabs>
  );
}
