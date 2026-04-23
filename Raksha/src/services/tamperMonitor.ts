import { firestore } from "../config/firebase";

const HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes (saves Firestore quota)

/**
 * 🔒 Tamper Monitor
 * Detects users who haven't sent a heartbeat within the timeout window.
 * Uses a Firestore query filter to only fetch users with a recent heartbeat
 * that has now gone stale, instead of scanning ALL users.
 */
export const startTamperMonitor = () => {
  setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS).toISOString();

      // Only query users who HAVE a heartbeat that is older than the cutoff.
      // Users without a heartbeat at all are excluded (no false positives).
      const snapshot = await firestore
        .collection("users")
        .where("lastHeartbeat", "<", cutoff)
        .get();

      if (snapshot.empty) return;

      const batch = firestore.batch();
      let eventCount = 0;

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const lastHeartbeat = data.lastHeartbeat;

        if (!lastHeartbeat) continue;

        // Double-check: only flag if the user was recently active (within 10 min)
        // This prevents flagging users who simply haven't opened the app in hours.
        const lastTime = new Date(lastHeartbeat).getTime();
        const diff = Date.now() - lastTime;
        if (diff > 10 * 60 * 1000) continue; // ignore if inactive > 10 min

        console.log(`[TAMPER] No heartbeat for user ${doc.id} (${Math.round(diff / 1000)}s ago)`);

        const eventRef = firestore.collection("tamper_events").doc();
        batch.set(eventRef, {
          userId: doc.id,
          detectedAt: new Date().toISOString(),
          reason: "heartbeat_timeout",
          lastHeartbeat,
        });
        eventCount++;
      }

      if (eventCount > 0) {
        await batch.commit();
        console.log(`[TAMPER] Logged ${eventCount} tamper event(s)`);
      }
    } catch (error) {
      console.error("Tamper monitor error:", error);
    }
  }, CHECK_INTERVAL_MS);
};