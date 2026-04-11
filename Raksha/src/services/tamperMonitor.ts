import { firestore } from "../config/firebase";

const HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

export const startTamperMonitor = () => {
  setInterval(async () => {
    try {
      const snapshot = await firestore.collection("users").get();
      const now = Date.now();

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const lastHeartbeat = data.lastHeartbeat;

        if (!lastHeartbeat) continue;

        const lastTime = new Date(lastHeartbeat).getTime();
        const diff = now - lastTime;

        if (diff > HEARTBEAT_TIMEOUT_MS) {
          console.log(`[TAMPER] No heartbeat for user ${doc.id}`);

          await firestore.collection("tamper_events").add({
            userId: doc.id,
            detectedAt: new Date().toISOString(),
            reason: "heartbeat_timeout",
          });
        }
      }
    } catch (error) {
      console.error("Tamper monitor error:", error);
    }
  }, 30000); // check every 30 seconds
};