import { View, Text, StyleSheet } from "react-native";

export default function Activity() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Activity Log</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0f1a", justifyContent: "center", alignItems: "center" },
  text: { color: "#fff" },
});