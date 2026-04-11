import { useState } from "react";
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
import { API_BASE } from "../../lib/api";

export default function Home() {
  const [incidentId, setIncidentId] = useState<string | null>(null);

  const pulse = useSharedValue(1);
  pulse.value = withRepeat(withTiming(1.15, { duration: 1500 }), -1, true);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const triggerSOS = async () => {
    try {
      const res = await fetch(`${API_BASE}/sos/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "testUser123",
          triggerType: "manual",
        }),
      });
  
      const data = await res.json();
      setIncidentId(data.incidentId);
    } catch (err) {
      console.log("Network error", err);
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
      </View>

      <View style={styles.sosWrapper}>
        <Animated.View style={[styles.glow, animatedStyle]}>
          <TouchableOpacity style={styles.sosButton} onPress={triggerSOS}>
            <Text style={styles.sosText}>SOS</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>

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
  },
  statusText: { fontSize: 16, fontWeight: "600" },
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