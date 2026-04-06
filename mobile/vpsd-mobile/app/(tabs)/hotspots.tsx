import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Button,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  Modal,
  Pressable,
  ScrollView,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { authenticatedFetch } from "../../src/api/client";

type HotspotCell = {
  id: number;
  grid_lat?: number;
  grid_lon?: number;
  recent_count: number;
  baseline_count: number;
  risk_score: number;
  top_crime_type?: string | null;
  top_crime_types?: string[];
  last_incident_at?: string | null;
  trend_pct?: number | null;
  summary?: string | null;
};

type HotspotsResponse = {
  cells: HotspotCell[];
};

type Incident = {
  id: number;
  external_id: string | null;
  source: string;
  incident_type: string;
  offense_category: string | null;
  block_address: string | null;
  code_section: string | null;
  offense_code: string | null;
  occurred_at: string;
  lat: number;
  lon: number;
};

type ForecastCell = {
  grid_lat: number;
  grid_lon: number;
  forecast_score: number;
  very_recent_24h: number;
  recent_7d: number;
  baseline: number;
};

// --- Offense category → color mapper ---
type CrimeColor = "violent" | "property" | "drug" | "other";

const _VIOLENT = ["assault", "robbery", "homicide", "murder", "rape", "kidnap", "weapon", "battery", "manslaughter", "arson"];
const _PROPERTY = ["burglary", "theft", "larceny", "vandalism", "vehicle_theft", "shoplifting", "stolen", "fraud", "forgery", "trespass"];
const _DRUG = ["drug", "narcotic", "dui", "marijuana", "cocaine", "substance", "prostitut", "vice"];

function getCrimeColor(type: string): CrimeColor {
  const lower = (type || "").toLowerCase();
  if (_VIOLENT.some((k) => lower.includes(k))) return "violent";
  if (_PROPERTY.some((k) => lower.includes(k))) return "property";
  if (_DRUG.some((k) => lower.includes(k))) return "drug";
  return "other";
}

function crimeColorToPin(c: CrimeColor): string {
  switch (c) {
    case "violent": return "#ef4444";
    case "property": return "#f59e0b";
    case "drug": return "#a855f7";
    case "other": return "#3b82f6";
  }
}

function crimeMarkerSize(c: CrimeColor): number {
  switch (c) {
    case "violent": return 14;
    case "property": return 11;
    case "drug": return 11;
    case "other": return 9;
  }
}

function formatIncidentDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCodeDetail(evt: Incident): string | null {
  if (evt.code_section && evt.offense_code) {
    return `${evt.code_section} / ${evt.offense_code}`;
  }
  return evt.code_section || evt.offense_code || null;
}

function formatFieldLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatFieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "Not provided";
  }
  if (key === "occurred_at" && typeof value === "string") {
    return formatIncidentDateTime(value);
  }
  if ((key === "lat" || key === "lon") && typeof value === "number") {
    return value.toFixed(6);
  }
  return String(value);
}

function buildPullSuccessMessage(params: {
  inserted: number;
  source: string;
  hotspotCells: number;
  mapLayer: "hotspots" | "incidents" | "forecast";
}): string {
  const { inserted, source, hotspotCells, mapLayer } = params;
  const incidentLine =
    inserted > 0
      ? `${inserted} new incident${inserted === 1 ? "" : "s"} pulled from ${source}.`
      : "No new incidents found. Existing incidents were refreshed.";
  const hotspotLine =
    hotspotCells > 0
      ? `Hotspots recomputed: ${hotspotCells} cell${hotspotCells === 1 ? "" : "s"}.`
      : "Hotspots recomputed.";

  if (mapLayer === "incidents") {
    return `${incidentLine}\n\n${hotspotLine}`;
  }
  return `${hotspotLine}\n\n${incidentLine}`;
}


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
  const showDemoControls = __DEV__;
  const [cells, setCells] = useState<HotspotCell[]>([]);
  const [events, setEvents] = useState<Incident[]>([]);
  const [forecast, setForecast] = useState<ForecastCell[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [mapLayer, setMapLayer] = useState<"hotspots" | "incidents" | "forecast">("hotspots");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);

  // Lazy-fetch only the data needed for a given layer
  const fetchLayer = async (layer: "hotspots" | "incidents" | "forecast") => {
    setLoading(true);
    try {
      if (layer === "hotspots" && cells.length === 0) {
        const res = await authenticatedFetch("/hotspots");
        if (!res.ok) throw new Error(`Hotspots ${res.status}: ${await res.text()}`);
        const data = await safeJson<HotspotsResponse>(res);
        if (__DEV__) console.log("[hotspots] fetched", data.cells?.length, "cells");
        setCells(Array.isArray(data.cells) ? data.cells : []);
      } else if (layer === "incidents" && events.length === 0) {
        const res = await authenticatedFetch("/events?days=7");
        if (!res.ok) throw new Error(`Events ${res.status}: ${await res.text()}`);
        const data = await safeJson<{ items: Incident[] }>(res);
        const items = Array.isArray(data.items) ? data.items : [];
        if (__DEV__) console.log("[hotspots] fetched", items.length, "incidents");
        setEvents(items);
        if (items.length > 0) setLastUpdated(items[0].occurred_at);
      } else if (layer === "forecast" && forecast.length === 0) {
        const res = await authenticatedFetch("/hotspots/forecast?source=sdpd_nibrs");
        if (!res.ok) throw new Error(`Forecast ${res.status}: ${await res.text()}`);
        const data = await safeJson<{ cells: ForecastCell[] }>(res);
        if (__DEV__) console.log("[hotspots] fetched", data.cells?.length, "forecast cells");
        setForecast(Array.isArray(data.cells) ? data.cells : []);
      }
    } catch (e: any) {
      console.log(e?.message || e);
      Alert.alert("Load Error", e?.message ? String(e.message) : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  // Full refresh — re-fetches all layers, used by Refresh button
  const refresh = async () => {
    setLoading(true);
    try {
      const [hotRes, evtRes, fcRes] = await Promise.all([
        authenticatedFetch("/hotspots"),
        authenticatedFetch("/events?days=7"),
        authenticatedFetch("/hotspots/forecast?source=sdpd_nibrs"),
      ]);
      const hotData = await safeJson<HotspotsResponse>(hotRes);
      setCells(Array.isArray(hotData.cells) ? hotData.cells : []);

      const evtData = await safeJson<{ items: Incident[] }>(evtRes);
      const items = Array.isArray(evtData.items) ? evtData.items : [];
      setEvents(items);

      const fcData = await safeJson<{ cells: ForecastCell[] }>(fcRes);
      setForecast(Array.isArray(fcData.cells) ? fcData.cells : []);

      if (items.length > 0) setLastUpdated(items[0].occurred_at);
    } catch (e: any) {
      console.log(e?.message || e);
      Alert.alert("Hotspots Error", e?.message ? String(e.message) : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const seedDemo = async () => {
    if (!showDemoControls) {
      return;
    }

    setLoading(true);
    try {
      const seedRes = await authenticatedFetch("/hotspots/seed?source=sdpd_demo&n=120", {
        method: "POST",
      });
      await safeJson(seedRes);

      const runRes = await authenticatedFetch("/hotspots/run?source=sdpd_demo", {
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

  const pullEvents = async () => {
    setLoading(true);
    try {
      const res = await authenticatedFetch("/events/pull?days=7", {
        method: "POST",
      });
      if (__DEV__) console.log("[hotspots] pull response status:", res.status);
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Pull failed (${res.status}): ${errText}`);
      }
      const data = await safeJson<{ inserted: number; source: string }>(res);
      if (__DEV__) console.log("[hotspots] pull result:", data);
      const inserted = data.inserted ?? 0;

      const hotRes = await authenticatedFetch(
        `/hotspots/run?source=${data.source || "sdpd_nibrs"}`,
        { method: "POST" }
      );
      if (!hotRes.ok) {
        const errText = await hotRes.text();
        throw new Error(`Hotspot run failed (${hotRes.status}): ${errText}`);
      }
      const hotData = await safeJson<{ cells: number }>(hotRes);
      if (__DEV__) console.log("[hotspots] run result:", hotData);

      await refresh();
      Alert.alert(
        "Events Pulled",
        buildPullSuccessMessage({
          inserted,
          source: data.source || "sdpd_nibrs",
          hotspotCells: hotData.cells ?? 0,
          mapLayer,
        })
      );
    } catch (e: any) {
      console.log("[hotspots] pullEvents error:", e?.message || e);
      Alert.alert("Pull Error", e?.message ? String(e.message) : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  // On mount, lazy-fetch only the default layer
  useEffect(() => {
    fetchLayer("hotspots");
  }, []);

  // When layer changes, lazy-fetch if not cached
  useEffect(() => {
    fetchLayer(mapLayer);
  }, [mapLayer]);

  // Pick a “center” for the map. If we have data, use the first cell.
  const centerLat =
    typeof cells?.[0]?.grid_lat === "number" ? cells[0].grid_lat! : 32.7157;
  const centerLon =
    typeof cells?.[0]?.grid_lon === "number" ? cells[0].grid_lon! : -117.1611;

  const incidentDetailRows = selectedIncident
    ? (() => {
        const preferredOrder = [
          "id",
          "external_id",
          "incident_type",
          "offense_category",
          "occurred_at",
          "block_address",
          "code_section",
          "offense_code",
          "source",
          "lat",
          "lon",
        ];
        const incidentRecord = selectedIncident as Record<string, unknown>;
        const orderedKeys = [
          ...preferredOrder.filter((key) => key in incidentRecord),
          ...Object.keys(incidentRecord).filter((key) => !preferredOrder.includes(key)),
        ];

        return orderedKeys.map((key) => ({
          key,
          label: formatFieldLabel(key),
          value: formatFieldValue(key, incidentRecord[key]),
        }));
      })()
    : [];

  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <View style={styles.container}>
        <Text style={styles.title}>📍 Hotspots</Text>
        <Text style={styles.sub}>
          {mapLayer === "hotspots" && `Cells: ${cells.length}`}
          {mapLayer === "incidents" && `Incidents: ${events.length}`}
          {mapLayer === "forecast" && `Forecast cells: ${forecast.length}`}
          {lastUpdated ? ` · Updated: ${new Date(lastUpdated).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
        </Text>

        <View style={styles.toggleRow}>
          <Text
            onPress={() => setViewMode("map")}
            style={[styles.toggleBtn, viewMode === "map" && styles.toggleActive]}
          >
            Map
          </Text>
          <Text
            onPress={() => setViewMode("list")}
            style={[styles.toggleBtn, viewMode === "list" && styles.toggleActive]}
          >
            List
          </Text>
        </View>

        {viewMode === "map" && (
          <View style={styles.toggleRow}>
            <Text
              onPress={() => setMapLayer("hotspots")}
              style={[styles.toggleBtn, mapLayer === "hotspots" && styles.toggleActive]}
            >
              Hotspots
            </Text>
            <Text
              onPress={() => setMapLayer("incidents")}
              style={[styles.toggleBtn, mapLayer === "incidents" && styles.toggleActive]}
            >
              Incidents
            </Text>
            <Text
              onPress={() => setMapLayer("forecast")}
              style={[styles.toggleBtn, mapLayer === "forecast" && styles.toggleActive]}
            >
              Forecast
            </Text>
          </View>
        )}

        <View style={styles.buttonRow}>
          {showDemoControls && (
            <TouchableOpacity
              onPress={seedDemo}
              disabled={loading}
              style={styles.demoBtn}
            >
              <Text style={styles.demoBtnText}>Demo Only</Text>
            </TouchableOpacity>
          )}
          <Button title="Pull Real Events" onPress={pullEvents} disabled={loading} />
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
              {/* --- Hotspot circles --- */}
              {mapLayer === "hotspots" &&
                cells
                  .filter((c) => typeof c.grid_lat === "number" && typeof c.grid_lon === "number")
                  .map((c) => {
                    const tier = getRiskTier(c.risk_score);
                    const size = getMarkerSize(tier);
                    const colors = getMarkerColor(tier);
                    const trendLabel =
                      c.trend_pct === null || c.trend_pct === undefined
                        ? "New Spike"
                        : `${c.trend_pct > 0 ? "+" : ""}${c.trend_pct}%`;
                    const topCrimes = c.top_crime_types?.length
                      ? `Top crimes: ${c.top_crime_types.join(", ")}`
                      : c.top_crime_type ? `Top crime: ${c.top_crime_type}` : null;
                    const desc = [
                      `${tier.charAt(0).toUpperCase() + tier.slice(1)} Risk`,
                      `Recent: ${c.recent_count} | Baseline: ${c.baseline_count}`,
                      `Trend: ${trendLabel}`,
                      topCrimes,
                      c.last_incident_at
                        ? `Last: ${new Date(c.last_incident_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                        : null,
                      c.summary || null,
                    ]
                      .filter(Boolean)
                      .join("\n");

                    return (
                      <Marker
                        key={String(c.id)}
                        coordinate={{ latitude: c.grid_lat!, longitude: c.grid_lon! }}
                        title={`Risk Score: ${c.risk_score}`}
                        description={desc}
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

              {/* --- Incident pins --- */}
              {mapLayer === "incidents" &&
                events.map((evt) => {
                  const cat = getCrimeColor(evt.offense_category || evt.incident_type);
                  const pin = crimeColorToPin(cat);
                  const sz = crimeMarkerSize(cat);
                  const title = evt.incident_type || "Incident";
                  const lines = [
                    evt.offense_category ? `Category: ${evt.offense_category}` : "Category unavailable",
                    "Tap for details",
                  ]
                    .filter(Boolean)
                    .join("\n");

                  return (
                    <Marker
                      key={`evt-${evt.id}`}
                      coordinate={{ latitude: evt.lat, longitude: evt.lon }}
                      title={title}
                      description={lines}
                      onCalloutPress={() => setSelectedIncident(evt)}
                    >
                      <View
                        style={{
                          width: sz,
                          height: sz,
                          borderRadius: sz / 2,
                          backgroundColor: pin,
                          borderWidth: 1.5,
                          borderColor: "rgba(0,0,0,0.3)",
                        }}
                      />
                    </Marker>
                  );
                })}

              {/* --- Forecast overlay (only in forecast layer) --- */}
              {mapLayer === "forecast" &&
                forecast.map((fc, i) => {
                  const maxScore = forecast[0]?.forecast_score || 1;
                  const intensity = Math.min(fc.forecast_score / maxScore, 1);
                  const size = 20 + intensity * 30;
                  return (
                    <Marker
                      key={`fc-${i}`}
                      coordinate={{ latitude: fc.grid_lat, longitude: fc.grid_lon }}
                      title={`Forecast: ${fc.forecast_score}`}
                      description={`Last 24h: ${fc.very_recent_24h} | 7d: ${fc.recent_7d} | Baseline: ${fc.baseline}`}
                    >
                      <View
                        style={{
                          width: size,
                          height: size,
                          borderRadius: size / 2,
                          backgroundColor: `rgba(168, 85, 247, ${0.25 + intensity * 0.45})`,
                          borderWidth: 2,
                          borderColor: `rgba(147, 51, 234, ${0.7 + intensity * 0.3})`,
                        }}
                      />
                    </Marker>
                  );
                })}
            </MapView>

            {/* Legend */}
            <View style={styles.legend}>
              {/* Hotspot risk levels */}
              {mapLayer === "hotspots" && (
                <>
                  <View style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: getMarkerColor("low").border }]} />
                    <Text style={styles.legendText}>Low (&lt;4)</Text>
                  </View>
                  <View style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: getMarkerColor("medium").border }]} />
                    <Text style={styles.legendText}>Med (4-7)</Text>
                  </View>
                  <View style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: getMarkerColor("high").border }]} />
                    <Text style={styles.legendText}>High (≥8)</Text>
                  </View>
                </>
              )}
              {/* Incident categories */}
              {mapLayer === "incidents" && (
                <>
                  <View style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: "#ef4444", width: 12, height: 12, borderRadius: 6 }]} />
                    <Text style={styles.legendText}>Violent</Text>
                  </View>
                  <View style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: "#f59e0b", width: 10, height: 10, borderRadius: 5 }]} />
                    <Text style={styles.legendText}>Property</Text>
                  </View>
                  <View style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: "#a855f7", width: 10, height: 10, borderRadius: 5 }]} />
                    <Text style={styles.legendText}>Drug/Vice</Text>
                  </View>
                  <View style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: "#3b82f6", width: 8, height: 8, borderRadius: 4 }]} />
                    <Text style={styles.legendText}>Other</Text>
                  </View>
                </>
              )}
              {/* Forecast — shown only in forecast */}
              {mapLayer === "forecast" && (
                <>
                  <View style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: "rgba(147, 51, 234, 0.5)" }]} />
                    <Text style={styles.legendText}>Lower Forecast</Text>
                  </View>
                  <View style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: "rgba(147, 51, 234, 1)" }]} />
                    <Text style={styles.legendText}>Higher Forecast</Text>
                  </View>
                </>
              )}
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
                {showDemoControls
                  ? "No hotspot cells yet. Tap \"Demo Only\" or pull real events."
                  : "No hotspot cells yet. Pull real events to populate this view."}
              </Text>
            }
          />
        )}
      </View>

      <Modal
        visible={selectedIncident !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedIncident(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSelectedIncident(null)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetEyebrow}>Incident Detail</Text>
                <Text style={styles.sheetTitle}>
                  {selectedIncident?.incident_type || "Incident"}
                </Text>
                <Text style={styles.sheetSubtitle}>
                  {selectedIncident?.offense_category || "Public dataset record"}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setSelectedIncident(null)}
                style={styles.sheetCloseBtn}
              >
                <Text style={styles.sheetCloseText}>Close</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.sheetBody}
              contentContainerStyle={styles.sheetBodyContent}
              showsVerticalScrollIndicator
            >
              <Text style={styles.fieldSectionTitle}>Available Fields</Text>
              {incidentDetailRows.map((row) => (
                <View key={row.key} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{row.label}</Text>
                  <Text style={styles.detailValue}>{row.value}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 24,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "78%",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    backgroundColor: "#0f0f10",
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 24,
    overflow: "hidden",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 12,
  },
  sheetEyebrow: {
    color: "#8f96a3",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  sheetTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    marginTop: 4,
  },
  sheetSubtitle: {
    color: "#b4bac5",
    fontSize: 14,
    marginTop: 4,
  },
  sheetCloseBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    backgroundColor: "#171717",
  },
  sheetCloseText: {
    color: "#f3f4f6",
    fontSize: 13,
    fontWeight: "700",
  },
  sheetBody: {
    flex: 1,
  },
  sheetBodyContent: {
    paddingBottom: 8,
    gap: 10,
  },
  fieldSectionTitle: {
    color: "#d6dae1",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  detailRow: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#232323",
    backgroundColor: "#151515",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  detailLabel: {
    color: "#8f96a3",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  detailValue: {
    color: "#f8fafc",
    fontSize: 15,
    lineHeight: 22,
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

  demoBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#333",
    backgroundColor: "transparent",
  },
  demoBtnText: {
    color: "#666",
    fontSize: 12,
    fontWeight: "600",
  },
});
