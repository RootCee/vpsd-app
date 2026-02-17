import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Button,
  FlatList,
  StyleSheet,
  Alert,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { API_BASE } from "../../src/config";

type HotspotCell = {
  id: number;
  grid_lat?: number;
  grid_lon?: number;
  recent_count: number;
  baseline_count: number;
  risk_score: number;
};

type HotspotsResponse = {
  cells: HotspotCell[];
};

async function safeJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text}`);
  }
}

// Risk tier helpers
type RiskTier = "low" | "medium" | "high";

function getRiskTier(riskScore: number): RiskTier {
  if (riskScore >= 8) return "high";
  if (riskScore >= 4) return "medium";
  return "low";
}

function getMarkerSize(tier: RiskTier): number {
  switch (tier) {
    case "low":
      return 20;
    case "medium":
      return 32;
    case "high":
      return 44;
  }
}

function getMarkerColor(tier: RiskTier): { bg: string; border: string } {
  switch (tier) {
    case "low":
      return { bg: "rgba(59, 130, 246, 0.4)", border: "rgba(37, 99, 235, 0.9)" }; // blue
    case "medium":
      return { bg: "rgba(251, 146, 60, 0.4)", border: "rgba(234, 88, 12, 0.9)" }; // orange
    case "high":
      return { bg: "rgba(239, 68, 68, 0.4)", border: "rgba(220, 38, 38, 0.9)" }; // red
  }
}

export default function Hotspots() {
  const [cells, setCells] = useState<HotspotCell[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/hotspots`);
      const data = await safeJson<HotspotsResponse>(res);
      setCells(Array.isArray(data.cells) ? data.cells : []);
    } catch (e: any) {
      console.log(e?.message || e);
      Alert.alert(
        "Hotspots Error",
        e?.message ? String(e.message) : "Unknown error"
      );
    } finally {
      setLoading(false);
    }
  };

  const seedDemo = async () => {
    setLoading(true);
    try {
      const seedRes = await fetch(
        `${API_BASE}/hotspots/seed?source=sdpd_demo&n=120`,
        { method: "POST" }
      );
      await safeJson(seedRes);

      const runRes = await fetch(`${API_BASE}/hotspots/run?source=sdpd_demo`, {
        method: "POST",
      });
      await safeJson(runRes);

      await refresh();
      setViewMode("map");
    } catch (e: any) {
      console.log(e?.message || e);
      Alert.alert("Seed Error", e?.message ? String(e.message) : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // Pick a “center” for the map. If we have data, use the first cell.
  const centerLat =
    typeof cells?.[0]?.grid_lat === "number" ? cells[0].grid_lat! : 32.7157;
  const centerLon =
    typeof cells?.[0]?.grid_lon === "number" ? cells[0].grid_lon! : -117.1611;

  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <View style={styles.container}>
        <Text style={styles.title}>📍 Hotspots</Text>
        <Text style={styles.sub}>Cells: {cells.length}</Text>

        <View style={styles.toggleRow}>
          <Text
            onPress={() => setViewMode("map")}
            style={[
              styles.toggleBtn,
              viewMode === "map" && styles.toggleActive,
            ]}
          >
            Map
          </Text>
          <Text
            onPress={() => setViewMode("list")}
            style={[
              styles.toggleBtn,
              viewMode === "list" && styles.toggleActive,
            ]}
          >
            List
          </Text>
        </View>

        <View style={styles.buttonRow}>
          <Button title="Seed Demo Data" onPress={seedDemo} disabled={loading} />
          <Button
            title={loading ? "Loading..." : "Refresh"}
            onPress={refresh}
            disabled={loading}
          />
        </View>

        {viewMode === "map" ? (
          <View style={styles.mapWrap}>
            <MapView
              style={{ flex: 1 }}
              initialRegion={{
                latitude: centerLat,
                longitude: centerLon,
                latitudeDelta: 0.25,
                longitudeDelta: 0.25,
              }}
            >
              {cells
                .filter(
                  (c) =>
                    typeof c.grid_lat === "number" &&
                    typeof c.grid_lon === "number"
                )
                .map((c) => {
                  const tier = getRiskTier(c.risk_score);
                  const size = getMarkerSize(tier);
                  const colors = getMarkerColor(tier);

                  return (
                    <Marker
                      key={String(c.id)}
                      coordinate={{ latitude: c.grid_lat!, longitude: c.grid_lon! }}
                      title={`Risk: ${c.risk_score}`}
                      description={`Recent: ${c.recent_count} | Baseline: ${c.baseline_count}\nCell: ${c.grid_lat!.toFixed(4)}, ${c.grid_lon!.toFixed(4)}`}
                    >
                      <View
                        style={{
                          width: size,
                          height: size,
                          borderRadius: size / 2,
                          backgroundColor: colors.bg,
                          borderWidth: 2,
                          borderColor: colors.border,
                        }}
                      />
                    </Marker>
                  );
                })}
            </MapView>

            {/* Legend */}
            <View style={styles.legend}>
              <View style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: getMarkerColor("low").border }]} />
                <Text style={styles.legendText}>Low (&lt;4)</Text>
              </View>
              <View style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: getMarkerColor("medium").border }]} />
                <Text style={styles.legendText}>Medium (4-7)</Text>
              </View>
              <View style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: getMarkerColor("high").border }]} />
                <Text style={styles.legendText}>High (≥8)</Text>
              </View>
            </View>
          </View>
        ) : (
          <FlatList
            data={cells}
            keyExtractor={(i) => String(i.id)}
            contentContainerStyle={{ paddingTop: 10, paddingBottom: 30 }}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Risk: {item.risk_score}</Text>
                <Text style={styles.cardText}>
                  Recent: {item.recent_count} | Baseline: {item.baseline_count}
                </Text>

                {typeof item.grid_lat === "number" &&
                  typeof item.grid_lon === "number" && (
                    <Text style={styles.cardSub}>
                      Cell: {item.grid_lat.toFixed(4)}, {item.grid_lon.toFixed(4)}
                    </Text>
                  )}
              </View>
            )}
            ListEmptyComponent={
              <Text style={{ color: "#aaa", marginTop: 20 }}>
                No hotspot cells yet. Tap “Seed Demo Data”.
              </Text>
            }
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  title: { fontSize: 26, fontWeight: "800", color: "white" },
  sub: { marginTop: 6, color: "#9aa0a6" },

  toggleRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  toggleBtn: {
    color: "#cfcfcf",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    backgroundColor: "#111",
    overflow: "hidden",
  },
  toggleActive: {
    color: "white",
    borderColor: "#5b8cff",
  },

  buttonRow: {
    marginTop: 14,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },

  mapWrap: {
    flex: 1,
    marginTop: 12,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    backgroundColor: "#111",
  },

  legend: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: "rgba(17, 17, 17, 0.95)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    padding: 10,
    gap: 6,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  legendDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  legendText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },

  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    backgroundColor: "#111",
    marginBottom: 10,
  },
  cardTitle: { fontSize: 18, fontWeight: "800", color: "white" },
  cardText: { marginTop: 6, color: "#dcdcdc" },
  cardSub: { marginTop: 6, color: "#9aa0a6", fontSize: 12 },
});
