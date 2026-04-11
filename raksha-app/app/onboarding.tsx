import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";

export default function Onboarding() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Always Protected</Text>
      <Text style={styles.desc}>
        Raksha keeps you safe with instant alerts & smart monitoring.
      </Text>

      <TouchableOpacity
        style={styles.button}
        onPress={() => router.replace("/(tabs)")}
      >
        <Text style={{ color: "#fff", fontWeight: "bold" }}>Get Started</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0f1a",
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
  },
  title: { color: "#fff", fontSize: 28, fontWeight: "bold", marginBottom: 15 },
  desc: { color: "#9ca3af", textAlign: "center", marginBottom: 30 },
  button: {
    backgroundColor: "#ff4757",
    padding: 18,
    borderRadius: 30,
    width: "100%",
    alignItems: "center",
  },
});