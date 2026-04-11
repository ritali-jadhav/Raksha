import { View, Text, StyleSheet } from "react-native";

export default function Guardian() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Guardian Dashboard</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0f1a", justifyContent: "center", alignItems: "center" },
  text: { color: "#fff" },
});