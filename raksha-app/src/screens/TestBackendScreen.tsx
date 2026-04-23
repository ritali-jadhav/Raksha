import React, { useState } from "react";
import { View, Text, Button } from "react-native";
import { API_BASE } from "../../lib/api";

export default function TestBackendScreen() {
  const [response, setResponse] = useState("");

  const testBackend = async () => {
    try {
      const res = await fetch(`${API_BASE}/health`);
      const data = await res.json();
      setResponse(JSON.stringify(data));
    } catch (err) {
      setResponse("Error connecting to backend");
      console.log(err);
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Button title="Test Backend" onPress={testBackend} />
      <Text style={{ marginTop: 20 }}>{response}</Text>
    </View>
  );
}
