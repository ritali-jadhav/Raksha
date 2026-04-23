import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Dimensions,
} from "react-native";
import MapView, { Polyline, Marker, PROVIDER_DEFAULT } from "react-native-maps";
import * as Location from "expo-location";
import { API_BASE } from "../../lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────
interface LatLng {
  lat: number;
  lng: number;
}

interface RouteResult {
  path: LatLng[];
  distance: number;
  safety_score: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getSafetyLabel = (score: number) => {
  if (score < 0.3) return { label: "Very Safe", color: "#2ed573" };
  if (score < 0.5) return { label: "Moderately Safe", color: "#ffa502" };
  if (score < 0.7) return { label: "Caution", color: "#ff6348" };
  return { label: "High Risk", color: "#ff4757" };
};

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

// ─── Component ────────────────────────────────────────────────────────────────
export default function SafeRouteScreen() {
  const mapRef = useRef<MapView>(null);

  const [destination, setDestination] = useState("");
  const [destCoords, setDestCoords] = useState<LatLng | null>(null);
  const [sourceCoords, setSourceCoords] = useState<LatLng | null>(null);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geocodeLoading, setGeocodeLoading] = useState(false);

  // Request GPS on mount
  useEffect(() => {
    fetchCurrentLocation();
  }, []);

  const fetchCurrentLocation = async () => {
    setLocationLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Location Permission Required",
          "Raksha needs your location to find safe routes. Please enable location permission in Settings."
        );
        setLocationLoading(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setSourceCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    } catch (e) {
      Alert.alert("Location Error", "Could not get your current location. Please try again.");
    } finally {
      setLocationLoading(false);
    }
  };

  // ── Geocode destination text → lat/lng using GraphHopper (same key as Python)
  const geocodeDestination = async (): Promise<LatLng | null> => {
    if (!destination.trim()) {
      Alert.alert("Enter Destination", "Please enter a destination to find a route.");
      return null;
    }

    setGeocodeLoading(true);
    try {
      const GH_API_KEY = "823224fe-2f07-44e8-9e7f-db72909eccd3";
      const url = `https://graphhopper.com/api/1/geocode?q=${encodeURIComponent(destination)}&locale=en&limit=1&key=${GH_API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      const hits = data?.hits;
      if (!hits || hits.length === 0) return null;
      const { lat, lng } = hits[0].point;
      return { lat, lng };
    } catch {
      return null;
    } finally {
      setGeocodeLoading(false);
    }
  };

  // ── Main: request safe route ──────────────────────────────────────────────
  const requestRoute = async () => {
    if (!sourceCoords) {
      Alert.alert("Location Unavailable", "Your current location is not available. Tap 'Refresh Location' to try again.");
      return;
    }

    setError(null);
    setRouteResult(null);

    const dest = await geocodeDestination();
    if (!dest) {
      setError("Could not find the destination. Please check the name and try again.");
      return;
    }
    setDestCoords(dest);

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/safe-route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceCoords, destination: dest }),
      });

      if (res.status === 503) {
        setError("The safe route service is currently offline. Please try again later.");
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || `Request failed (${res.status})`);
        return;
      }

      const data: RouteResult = await res.json();

      if (!data.path || data.path.length === 0) {
        setError("No route found between your location and the destination.");
        return;
      }

      setRouteResult(data);

      // Fit map to route
      if (mapRef.current) {
        const coords = data.path.map((p) => ({ latitude: p.lat, longitude: p.lng }));
        mapRef.current.fitToCoordinates(coords, {
          edgePadding: { top: 60, right: 40, bottom: 60, left: 40 },
          animated: true,
        });
      }
    } catch {
      setError("Network error. Check your connection and ensure the backend is running.");
    } finally {
      setLoading(false);
    }
  };

  const clearRoute = () => {
    setRouteResult(null);
    setDestCoords(null);
    setDestination("");
    setError(null);
  };

  // ── Map region: center on source or India default ─────────────────────────
  const mapRegion = sourceCoords
    ? {
        latitude: sourceCoords.lat,
        longitude: sourceCoords.lng,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    : {
        latitude: 18.5204,
        longitude: 73.8567,
        latitudeDelta: 0.1,
        longitudeDelta: 0.1,
      };

  const safetyInfo = routeResult ? getSafetyLabel(routeResult.safety_score) : null;

  // ──────────────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.wrapper}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🛡️ Safe Route</Text>
        <Text style={styles.headerSubtitle}>Find the safest path to your destination</Text>
      </View>

      {/* ── Map ────────────────────────────────────────────────────────────── */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_DEFAULT}
          initialRegion={mapRegion}
          showsUserLocation={true}
          showsMyLocationButton={false}
        >
          {/* Source marker */}
          {sourceCoords && (
            <Marker
              coordinate={{ latitude: sourceCoords.lat, longitude: sourceCoords.lng }}
              title="You are here"
              pinColor="#2ed573"
            />
          )}

          {/* Destination marker */}
          {destCoords && (
            <Marker
              coordinate={{ latitude: destCoords.lat, longitude: destCoords.lng }}
              title={destination || "Destination"}
              pinColor="#ff4757"
            />
          )}

          {/* Route polyline */}
          {routeResult && (
            <Polyline
              coordinates={routeResult.path.map((p) => ({
                latitude: p.lat,
                longitude: p.lng,
              }))}
              strokeColor="#7c3aed"
              strokeWidth={4}
              lineDashPattern={undefined}
            />
          )}
        </MapView>

        {/* Location loading overlay */}
        {locationLoading && (
          <View style={styles.mapOverlay}>
            <ActivityIndicator size="small" color="#7c3aed" />
            <Text style={styles.mapOverlayText}>Getting your location…</Text>
          </View>
        )}
      </View>

      {/* ── Bottom Panel ───────────────────────────────────────────────────── */}
      <ScrollView
        style={styles.panel}
        contentContainerStyle={styles.panelContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Route info card */}
        {routeResult && safetyInfo && (
          <View style={[styles.infoCard, { borderLeftColor: safetyInfo.color }]}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Safety</Text>
              <Text style={[styles.infoValue, { color: safetyInfo.color }]}>
                {safetyInfo.label}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Distance</Text>
              <Text style={styles.infoValue}>{routeResult.distance} km</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Risk Score</Text>
              <Text style={styles.infoValue}>
                {(routeResult.safety_score * 100).toFixed(0)}%
              </Text>
            </View>
          </View>
        )}

        {/* Error message */}
        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
          </View>
        )}

        {/* Destination input */}
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Destination</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Koregaon Park, Pune"
            placeholderTextColor="#6b7280"
            value={destination}
            onChangeText={setDestination}
            returnKeyType="search"
            onSubmitEditing={requestRoute}
            editable={!loading}
          />
        </View>

        {/* Location refresh */}
        <TouchableOpacity
          style={styles.locationBtn}
          onPress={fetchCurrentLocation}
          disabled={locationLoading}
        >
          <Text style={styles.locationBtnText}>
            {locationLoading ? "Locating…" : sourceCoords ? "📍 Location Acquired — Refresh" : "📍 Get My Location"}
          </Text>
        </TouchableOpacity>

        {/* Action buttons */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.primaryBtn, loading && styles.btnDisabled]}
            onPress={requestRoute}
            disabled={loading || locationLoading || geocodeLoading}
          >
            {loading || geocodeLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>Find Safe Route</Text>
            )}
          </TouchableOpacity>

          {routeResult && (
            <TouchableOpacity style={styles.clearBtn} onPress={clearRoute}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: "#0a0f1a" },

  header: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 56 : 32,
    paddingBottom: 12,
    backgroundColor: "#0a0f1a",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    color: "#6b7280",
    fontSize: 13,
    marginTop: 2,
  },

  mapContainer: {
    height: SCREEN_HEIGHT * 0.4,
    position: "relative",
  },
  map: { flex: 1 },
  mapOverlay: {
    position: "absolute",
    bottom: 12,
    left: 16,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(10,15,26,0.85)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 8,
  },
  mapOverlayText: { color: "#fff", fontSize: 12 },

  panel: {
    flex: 1,
    backgroundColor: "#0d1220",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -20,
  },
  panelContent: {
    padding: 20,
    paddingTop: 24,
    gap: 14,
  },

  infoCard: {
    backgroundColor: "rgba(124,58,237,0.1)",
    borderRadius: 16,
    padding: 16,
    borderLeftWidth: 4,
    gap: 10,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  infoLabel: { color: "#9ca3af", fontSize: 14 },
  infoValue: { color: "#fff", fontSize: 14, fontWeight: "600" },

  errorCard: {
    backgroundColor: "rgba(255,71,87,0.12)",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,71,87,0.3)",
  },
  errorText: { color: "#ff6b78", fontSize: 13, lineHeight: 19 },

  inputContainer: { gap: 6 },
  inputLabel: { color: "#9ca3af", fontSize: 12, fontWeight: "600", letterSpacing: 0.5 },
  input: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#fff",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },

  locationBtn: {
    backgroundColor: "rgba(46,213,115,0.1)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "rgba(46,213,115,0.25)",
    alignItems: "center",
  },
  locationBtnText: { color: "#2ed573", fontSize: 13, fontWeight: "600" },

  buttonRow: { flexDirection: "row", gap: 10 },

  primaryBtn: {
    flex: 1,
    backgroundColor: "#7c3aed",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    shadowColor: "#7c3aed",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  btnDisabled: { opacity: 0.55 },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  clearBtn: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  clearBtnText: { color: "#9ca3af", fontSize: 15, fontWeight: "600" },
});
