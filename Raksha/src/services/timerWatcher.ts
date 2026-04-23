import { firestore } from "../config/firebase";
import { createIncident } from "./sosService";

const CHECK_INTERVAL_MS = 3 * 60 * 1000; // Check every 3 minutes (saves Firestore quota)

/**
 * 🔒 Mark a timer/journey as auto-triggered so we don't fire SOS twice.
 */
async function markAutoTriggered(
  collection: string,
  docId: string
): Promise<void> {
  await firestore
    .collection(collection)
    .doc(docId)
    .update({
      status: "auto_triggered",
      autoTriggeredAt: new Date().toISOString(),
    })
    .catch(() => {});
}

/**
 * ⏱️ Check for expired Dead Man's Switch timers.
 * If a timer has status=active and expiresAt is in the past, trigger SOS.
 */
async function checkExpiredTimers(): Promise<void> {
  try {
    const now = new Date();

    const snapshot = await firestore
      .collection("checkin_timers")
      .where("status", "==", "active")
      // NOTE: Avoid composite index requirement (status + expiresAt).
      // We filter by expiresAt in-memory for demo/dev stability.
      .get();

    if (snapshot.empty) return;

    const expiredDocs = snapshot.docs.filter((doc) => {
      const data: any = doc.data();
      const expiresAt = data?.expiresAt;
      if (typeof expiresAt !== "string" || expiresAt.length === 0) return false;
      const expiresAtDate = new Date(expiresAt);
      return !Number.isNaN(expiresAtDate.getTime()) && expiresAtDate <= now;
    });

    if (expiredDocs.length === 0) return;

    console.log(
      `[TIMER_WATCHER] Found ${expiredDocs.length} expired check-in timer(s)`
    );

    for (const doc of expiredDocs) {
      const data = doc.data();
      const userId = data.userId;

      if (!userId) continue;

      console.log(
        `[TIMER_WATCHER] Check-in timer expired for user ${userId} (timer: ${doc.id})`
      );

      // Mark immediately to prevent duplicate triggers
      await markAutoTriggered("checkin_timers", doc.id);

      // Get last known location
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const locDoc = await firestore
          .collection("live_locations")
          .doc(userId)
          .get();
        if (locDoc.exists) {
          lat = locDoc.data()?.lat;
          lng = locDoc.data()?.lng;
        }
      } catch {}

      // Fire SOS
      try {
        const incidentId = await createIncident(
          userId,
          "dead_mans_switch",
          lat,
          lng
        );
        console.log(
          `[TIMER_WATCHER] SOS triggered for expired timer — incident: ${incidentId}`
        );

        // Log the auto-trigger event
        await firestore.collection("auto_sos_events").add({
          userId,
          incidentId,
          trigger: "dead_mans_switch",
          timerId: doc.id,
          triggeredAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error(
          `[TIMER_WATCHER] Failed to trigger SOS for user ${userId}:`,
          err
        );
      }
    }
  } catch (err) {
    console.error("[TIMER_WATCHER] checkExpiredTimers error:", err);
  }
}

/**
 * 🧭 Check for overdue journeys.
 * If a journey has status=active and etaAt is in the past, trigger SOS.
 */
async function checkOverdueJourneys(): Promise<void> {
  try {
    const now = new Date();

    const snapshot = await firestore
      .collection("journeys")
      .where("status", "==", "active")
      // NOTE: Avoid composite index requirement (status + etaAt).
      // We filter by etaAt in-memory for demo/dev stability.
      .get();

    if (snapshot.empty) return;

    const overdueDocs = snapshot.docs.filter((doc) => {
      const data: any = doc.data();
      const etaAt = data?.etaAt;
      if (typeof etaAt !== "string" || etaAt.length === 0) return false;
      const etaAtDate = new Date(etaAt);
      return !Number.isNaN(etaAtDate.getTime()) && etaAtDate <= now;
    });

    if (overdueDocs.length === 0) return;

    console.log(
      `[TIMER_WATCHER] Found ${overdueDocs.length} overdue journey(s)`
    );

    for (const doc of overdueDocs) {
      const data = doc.data();
      const userId = data.userId;

      if (!userId) continue;

      console.log(
        `[TIMER_WATCHER] Journey overdue for user ${userId} (journey: ${doc.id})`
      );

      // Mark immediately to prevent duplicate triggers
      await markAutoTriggered("journeys", doc.id);

      // Get last known location
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const locDoc = await firestore
          .collection("live_locations")
          .doc(userId)
          .get();
        if (locDoc.exists) {
          lat = locDoc.data()?.lat;
          lng = locDoc.data()?.lng;
        }
      } catch {}

      // Fire SOS
      try {
        const incidentId = await createIncident(
          userId,
          "journey_overdue",
          lat,
          lng
        );
        console.log(
          `[TIMER_WATCHER] SOS triggered for overdue journey — incident: ${incidentId}`
        );

        // Log the auto-trigger event
        await firestore.collection("auto_sos_events").add({
          userId,
          incidentId,
          trigger: "journey_overdue",
          journeyId: doc.id,
          destination: data.destination || "Unknown",
          triggeredAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error(
          `[TIMER_WATCHER] Failed to trigger SOS for user ${userId}:`,
          err
        );
      }
    }
  } catch (err) {
    console.error("[TIMER_WATCHER] checkOverdueJourneys error:", err);
  }
}

/**
 * 🚀 Start the server-side timer watcher.
 * Runs every 60 seconds — catches expired timers/journeys even if
 * the user's browser tab is closed.
 */
export function startTimerWatcher(): void {
  console.log("[TIMER_WATCHER] Starting (60s interval)");

  // Run immediately on start to catch anything that expired during downtime
  checkExpiredTimers().catch(() => {});
  checkOverdueJourneys().catch(() => {});

  setInterval(() => {
    checkExpiredTimers().catch(() => {});
    checkOverdueJourneys().catch(() => {});
  }, CHECK_INTERVAL_MS);
}
