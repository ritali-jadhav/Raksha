import { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { CameraView } from "expo-camera";
import * as Location from "expo-location";
import { API_BASE } from "../../lib/api";
import { useSosMediaCapture } from "../../lib/useSosMediaCapture";

// ─── Auth token placeholder ───────────────────────────────────────────────────
// Replace with your actual token from SecureStore / AuthContext once auth is wired.
const AUTH_TOKEN = "your-jwt-token-here";

export default function Home() {
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<string>("");

  const pulse = useSharedValue(1);
  pulse.value = withRepeat(withTiming(1.15, { duration: 1500 }), -1, true);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  // ── SOS media capture hook ─────────────────────────────────────────────────
  const { cameraRef, captureAndUpload } = useSosMediaCapture((patch) => {
    if (patch.capturing === true) setCaptureStatus("📷 Capturing evidence…");
    if (patch.imageUploaded === true) setCaptureStatus("🖼️ Image uploaded");
    if (patch.videoUploaded === true) setCaptureStatus("✅ Evidence uploaded");
    if (patch.error) setCaptureStatus("⚠️ Evidence capture failed (SOS still active)");
  });

  // ── SOS trigger ───────────────────────────────────────────────────────────
  const triggerSOS = async () => {
    try {
      // 1. Grab live location FAST (cached or low-accuracy) so the SMS includes it
      let latitude: number | undefined;
      let longitude: number | undefined;

      try {
        // Request permission if not already granted
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          // Use last known position first (instant, no GPS wait)
          const lastKnown = await Location.getLastKnownPositionAsync();
          if (lastKnown) {
            latitude = lastKnown.coords.latitude;
            longitude = lastKnown.coords.longitude;
            console.log(`[SOS] Using last known location: ${latitude}, ${longitude}`);
          } else {
            // Fall back to a quick low-accuracy fix (max 2s timeout)
            const quickFix = await Promise.race([
              Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
              }),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
            ]);
            if (quickFix) {
              latitude = quickFix.coords.latitude;
              longitude = quickFix.coords.longitude;
              console.log(`[SOS] Using quick GPS fix: ${latitude}, ${longitude}`);
            }
          }
        }
      } catch (locErr) {
        console.warn("[SOS] Location fetch failed (SOS will proceed without coords):", locErr);
      }

      // 2. Trigger SOS on backend WITH location
      const res = await fetch(`${API_BASE}/sos/trigger`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify({ triggerType: "manual", latitude, longitude }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.warn(`[SOS] Trigger failed (${res.status}): ${errorText}`);
        return;
      }

      const data = await res.json();
      const id: string | undefined = data.incidentId;

      if (!id) {
        console.warn("[SOS] No incidentId returned from trigger");
        return;
      }

      setIncidentId(id);

      // 3. Fire-and-forget: capture + upload media automatically
      // This runs asynchronously — SOS is confirmed before media finishes
      captureAndUpload(id, AUTH_TOKEN);

      // 4. Non-blocking: get high-accuracy GPS and send follow-up location update
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
        .then((pos) => {
          fetch(`${API_BASE}/sos/location-update`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${AUTH_TOKEN}`,
            },
            body: JSON.stringify({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            }),
          }).catch(() => {});
        })
        .catch(() => {});

    } catch (err) {
      console.error("[SOS] Network error:", err);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>Raksha</Text>

      <View style={styles.statusCard}>
        <Text
          style={[
            styles.statusText,
            { color: incidentId ? "#ff4757" : "#2ed573" },
          ]}
        >
          {incidentId ? "🚨 Incident Active" : "You're Safe"}
        </Text>

        {/* Evidence capture status badge */}
        {captureStatus !== "" && (
          <Text style={styles.captureStatus}>{captureStatus}</Text>
        )}
      </View>

      <View style={styles.sosWrapper}>
        <Animated.View style={[styles.glow, animatedStyle]}>
          <TouchableOpacity style={styles.sosButton} onPress={triggerSOS}>
            <Text style={styles.sosText}>SOS</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* Hidden camera view — needed for expo-camera to function */}
      <CameraView
        ref={cameraRef}
        style={styles.hiddenCamera}
        facing="back"
        mode="video"
      />

      <View style={styles.grid}>
        {["Quick Alert", "Fake Call", "Share Location", "Nearby Help"].map(
          (item) => (
            <View key={item} style={styles.gridItem}>
              <Text style={styles.gridText}>{item}</Text>
            </View>
          )
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0f1a", padding: 20 },
  header: { color: "#fff", fontSize: 28, fontWeight: "bold", marginBottom: 20 },
  statusCard: {
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 18,
    borderRadius: 20,
    marginBottom: 30,
    gap: 6,
  },
  statusText: { fontSize: 16, fontWeight: "600" },
  captureStatus: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 4,
  },
  sosWrapper: { alignItems: "center", marginBottom: 30 },
  glow: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(255,71,87,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  sosButton: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "#ff4757",
    justifyContent: "center",
    alignItems: "center",
  },
  sosText: { color: "#fff", fontSize: 40, fontWeight: "bold" },
  hiddenCamera: {
    width: 1,
    height: 1,
    opacity: 0,
    position: "absolute",
    top: 0,
    left: 0,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  gridItem: {
    width: "48%",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 20,
    borderRadius: 16,
    marginBottom: 15,
  },
  gridText: { color: "#fff" },
});