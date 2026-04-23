import { firestore } from "../config/firebase";
import admin from "../config/firebase";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { startEscalation, stopEscalation } from "./escalationService";
import { notifyGuardians, getAllGuardianPhones } from "./guardianService";
import { emitSOSTriggered, emitSOSCancelled, emitSOSResolved, emitLocationUpdate, emitMediaCaptured } from "./socketManager";
import { sendSOSToAllGuardians, sendSOSAlert, callGuardiansSequentially, sendSafeSMS, sendMediaFollowUpSMS } from "./twilioService";
import { sendPushToGuardians } from "./webPushService";

type EvidenceType = "image" | "video" | "audio";
type EvidenceLink = { url: string; type: EvidenceType; createdAt: string };


/**
 * 🔴 Create Incident (Manual or Auto Trigger)
 * Now accepts optional latitude/longitude and stores a complete SOS event.
 */
export const createIncident = async (
  userId: string,
  triggerType: string = "manual",
  latitude?: number,
  longitude?: number
): Promise<string> => {
  // ── Fast path: return existing active incident immediately ─────────────
  const existingSnapshot = await firestore
    .collection("incidents")
    .where("userId", "==", userId)
    .where("status", "==", "active")
    .limit(1)
    .get();

  if (!existingSnapshot.empty) {
    const existingId = existingSnapshot.docs[0].id;
    const existingData = existingSnapshot.docs[0].data();
    console.log(`[SOS] Active incident already exists for user ${userId}: ${existingId} | smsAlertSent=${existingData?.smsAlertSent}`);

    // If SMS hasn't been sent yet for this incident, kick off alerts again
    if (!existingData?.smsAlertSent) {
      console.log(`[SOS] SMS not yet sent for ${existingId} — retrying alerts`);
      runPostCreateTasks(userId, existingId, triggerType, latitude, longitude).catch((err) =>
        console.error("[SOS] Background tasks for existing incident failed:", err)
      );
    }

    return existingId;
  }

  // ── Create incident record immediately ─────────────────────────────────
  const incidentId = uuidv4();
  const now = new Date().toISOString();

  await firestore.collection("incidents").doc(incidentId).set({
    incidentId,
    userId,
    triggerType,
    status: "active",
    createdAt: now,
    timestamp: now,
    latitude: latitude || null,
    longitude: longitude || null,
    guardianPhones: [],
    mediaUrl: null,
    mediaType: null,
    evidenceLinks: [],
    smsAlertSent: false,
    evidenceAlertSent: false,
    escalationStage: 0,
  });

  console.log(`[SOS] Incident created: ${incidentId} — running background tasks`);

  // ── Everything below runs in background (non-blocking) ─────────────────
  // The incidentId is returned to the client IMMEDIATELY.
  runPostCreateTasks(userId, incidentId, triggerType, latitude, longitude).catch((err) =>
    console.error("[SOS] Background tasks failed:", err)
  );

  startEscalation(incidentId);

  return incidentId;
};

/**
 * Background tasks after incident creation.
 * Runs AFTER the client already has the incidentId.
 * Failures here are logged but never block the SOS response.
 */
async function runPostCreateTasks(
  userId: string,
  incidentId: string,
  triggerType: string,
  latitude?: number,
  longitude?: number
): Promise<void> {
  console.log(`[SOS-BG] Starting background tasks for incident ${incidentId}`);
  console.log(`[SOS-BG] Input coords: lat=${latitude}, lng=${longitude}`);

  // ── 1. Resolve location (fallback to live_locations) ───────────────────
  let lat = latitude;
  let lng = longitude;
  if (lat == null || lng == null) {
    try {
      const locDoc = await firestore.collection("live_locations").doc(userId).get();
      if (locDoc.exists) {
        lat = locDoc.data()?.lat;
        lng = locDoc.data()?.lng;
        console.log(`[SOS-BG] Resolved location from live_locations: lat=${lat}, lng=${lng}`);
      } else {
        console.log(`[SOS-BG] No live_locations doc found for user ${userId}`);
      }
    } catch (err) {
      console.error(`[SOS-BG] Error reading live_locations:`, err);
    }
  } else {
    console.log(`[SOS-BG] Using provided coords: lat=${lat}, lng=${lng}`);
  }

  // ── 2. Resolve guardian phones + user name in parallel ─────────────────
  const [guardianPhones, userDoc] = await Promise.all([
    getAllGuardianPhones(userId).catch((err) => { console.error("[SOS-BG] getAllGuardianPhones failed:", err); return [] as string[]; }),
    firestore.collection("users").doc(userId).get().catch((err) => { console.error("[SOS-BG] user doc fetch failed:", err); return null; }),
  ]);

  const userName = userDoc?.exists ? userDoc.data()?.name || "Unknown" : "Unknown";
  const userPhone = userDoc?.exists ? userDoc.data()?.phone || null : null;

  console.log(`[SOS-BG] User: ${userName} | Phones found: ${guardianPhones.length} → [${guardianPhones.join(', ')}]`);

  // ── 3. Patch incident with resolved data ───────────────────────────────
  await firestore.collection("incidents").doc(incidentId).update({
    latitude: lat || null,
    longitude: lng || null,
    guardianPhones,
  }).catch((err) => console.error("[SOS-BG] Incident patch failed:", err));

  // ── 4. Notify guardians (Firestore notifications) ─────────────────────
  const eventType = triggerType === "geofence_breach" ? "geofence_breach" as const : "sos_triggered" as const;
  notifyGuardians(userId, eventType, { incidentId }).catch((err) =>
    console.error("[SOS-BG] Guardian notification failed:", err)
  );

  // ── 5. WebSocket real-time event ──────────────────────────────────────
  try {
    emitSOSTriggered(userId, incidentId, userName, triggerType, userPhone);
  } catch (err) {
    console.error("[SOS-BG] Socket emit failed:", err);
  }

  // ── 6. Send SMS DIRECTLY — same simple pattern as the working cancellation SMS ──
  if (guardianPhones.length === 0) {
    console.warn("[SOS-BG] ⚠️ NO GUARDIAN PHONES — SMS will NOT be sent.");
  } else {
    console.log(`[SOS-BG] Sending SOS alert SMS to ${guardianPhones.length} phone(s)...`);
    let smsSent = 0;
    for (const phone of guardianPhones) {
      try {
        const ok = await sendSOSAlert(phone, userName, lat ?? 0, lng ?? 0);
        console.log(`[SOS-BG] SMS to ${phone}: ${ok ? '✅ SENT' : '❌ FAILED'}`);
        if (ok) smsSent++;
      } catch (smsErr) {
        console.error(`[SOS-BG] SMS to ${phone} threw:`, smsErr);
      }
    }
    // Mark SMS as sent on incident to prevent duplicate sends
    if (smsSent > 0) {
      firestore.collection("incidents").doc(incidentId).update({
        smsAlertSent: true,
        smsAlertSentAt: new Date().toISOString(),
        smsSent,
      }).catch(() => {});
    }
  }

  // ── 7. Voice calls (non-critical, fire-and-forget) ────────────────────
  if (guardianPhones.length > 0) {
    callGuardiansSequentially(guardianPhones, userName, lat ?? 0, lng ?? 0).catch((err) =>
      console.error("[SOS-BG] Voice calls failed:", err)
    );
  }

  console.log(`[SOS-BG] Background tasks complete for ${incidentId}`);
}

/**
 * 📎 Attach media to an existing incident and send follow-up SMS to guardians.
 * Called after Cloudinary upload completes.
 */
export const attachMediaToIncident = async (
  incidentId: string,
  mediaUrl: string,
  mediaType: EvidenceType
): Promise<{ success: boolean; message: string }> => {
  try {
    const incidentRef = firestore.collection("incidents").doc(incidentId);
    const incidentDoc = await incidentRef.get();

    if (!incidentDoc.exists) {
      return { success: false, message: "Incident not found" };
    }

    const incidentData = incidentDoc.data();
    const userId = incidentData?.userId;

    const createdAt = new Date().toISOString();

    // Update incident with media URL (backward compat) + append evidence link
    await incidentRef.update({
      mediaUrl,
      mediaType,
      mediaUpdatedAt: createdAt,
      evidenceLinks: admin.firestore.FieldValue.arrayUnion({
        url: mediaUrl,
        type: mediaType,
        createdAt,
      } as EvidenceLink),
      evidenceUpdatedAt: createdAt,
    });

    console.log(`[SOS] Media attached to incident ${incidentId}: ${mediaUrl}`);

    // Emit WebSocket event so guardian UI updates in real-time
    if (userId) {
      emitMediaCaptured(userId, incidentId, mediaUrl, mediaType);
    }

    // Send SMS (evidence update) immediately for this newly attached media
    if (userId) {
      sendEvidenceUpdateIfNeeded(userId, incidentId, mediaUrl).catch((err) =>
        console.error("[SOS] Evidence update SMS failed:", err)
      );
    }

    // Send web push notification with direct Cloudinary link (non-blocking)
    if (userId) {
      const userDoc = await firestore.collection("users").doc(userId).get().catch(() => null);
      const userName = userDoc?.exists ? userDoc.data()?.name || "User" : "User";
      sendPushToGuardians(
        userId,
        "📎 Evidence Captured",
        `${userName}'s SOS captured media — tap to view`,
        {
          tag: `raksha-evidence-${incidentId}`,
          url: mediaUrl,          // Opens Cloudinary URL directly
          actions: [
            { action: "view", title: "🖼️ View Evidence" },
          ],
        },
        "high"
      ).catch((err) => console.error("[SOS] Push for media failed:", err));
    }

    return { success: true, message: "Media attached" };
  } catch (err) {
    console.error("[SOS] attachMediaToIncident error:", err);
    return { success: false, message: "Failed to attach media" };
  }
};

async function sendEvidenceUpdateIfNeeded(userId: string, incidentId: string, mediaUrl: string): Promise<void> {
  try {
    const incidentRef = firestore.collection("incidents").doc(incidentId);
    const incDoc = await incidentRef.get();
    if (!incDoc.exists) {
      console.warn("[SOS-EVIDENCE-SMS] Incident not found:", incidentId);
      return;
    }

    const incData: any = incDoc.data();
    if (incData?.status !== "active") {
      console.warn("[SOS-EVIDENCE-SMS] Incident not active, skipping evidence SMS");
      return;
    }

    // Resolve user name
    let userName = "User";
    try {
      const userDoc = await firestore.collection("users").doc(userId).get();
      if (userDoc.exists) userName = userDoc.data()?.name || "User";
    } catch (err) {
      console.error("[SOS-EVIDENCE-SMS] Error fetching user name:", err);
    }

    // Resolve lat/lng — use incident coords, fall back to live_locations
    let lat: number | null = (typeof incData?.latitude === "number" && incData.latitude !== 0)
      ? incData.latitude : null;
    let lng: number | null = (typeof incData?.longitude === "number" && incData.longitude !== 0)
      ? incData.longitude : null;

    if (!lat || !lng) {
      try {
        const locDoc = await firestore.collection("live_locations").doc(userId).get();
        if (locDoc.exists) {
          const locData = locDoc.data();
          lat = locData?.lat || null;
          lng = locData?.lng || null;
          console.log(`[SOS-EVIDENCE-SMS] Fell back to live_locations: lat=${lat}, lng=${lng}`);
        }
      } catch (err) {
        console.error("[SOS-EVIDENCE-SMS] Error fetching live location:", err);
      }
    }

    const phones = await getAllGuardianPhones(userId);
    if (phones.length === 0) {
      console.warn("[SOS-EVIDENCE-SMS] No guardian phones found for user:", userId);
      return;
    }

    console.log(`[SOS-EVIDENCE-SMS] Sending evidence SMS to ${phones.length} guardian(s) | url=${mediaUrl} | lat=${lat} lng=${lng}`);

    for (const phone of phones) {
      sendMediaFollowUpSMS(phone, userName, mediaUrl, lat, lng)
        .then(ok => console.log(`[SOS-EVIDENCE-SMS] ${ok ? '✅' : '❌'} to ${phone}`))
        .catch(err => console.error(`[SOS-EVIDENCE-SMS] Error sending to ${phone}:`, err));
    }

    // Mark evidence alert sent in Firestore
    await incidentRef.update({
      evidenceAlertSent: true,
      evidenceAlertSentAt: new Date().toISOString(),
      evidenceAlertCount: admin.firestore.FieldValue.increment(1),
    }).catch(() => {});
  } catch (err) {
    console.error("[SOS-EVIDENCE-SMS] Unexpected error:", err);
  }
}

/**
 * ✅ Verify PIN and Cancel Incident
 */
export const verifyPinAndCancelIncident = async (
  userId: string,
  incidentId: string,
  pin: string
) => {
  const incidentRef = firestore.collection("incidents").doc(incidentId);
  const incidentDoc = await incidentRef.get();

  if (!incidentDoc.exists) {
    return { success: false, message: "Incident not found" };
  }

  const incidentData = incidentDoc.data();

  if (incidentData?.userId !== userId) {
    return { success: false, message: "Unauthorized" };
  }

  // Fetch the hashed PIN from user profile
  let storedPin = "";

  try {
    const userDoc = await firestore.collection("users").doc(userId).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      if (userData?.safetyPin) {
        storedPin = userData.safetyPin;
      }
    }
  } catch (err) {
    console.error(`[SOS] Failed to fetch user PIN for userId: ${userId}`, err);
  }

  if (!storedPin) {
    // No PIN set — fail-safe: don't allow cancellation without a PIN
    return { success: false, message: "No safety PIN configured" };
  }

  // Compare using bcrypt (handles both hashed and legacy plain-text PINs)
  let pinMatch = false;
  try {
    pinMatch = await bcrypt.compare(pin, storedPin);
  } catch {
    // Fallback: if storedPin is not a valid bcrypt hash (legacy plain-text),
    // do a direct comparison and re-hash it for future use
    pinMatch = pin === storedPin;
    if (pinMatch) {
      // Migrate legacy plain-text PIN to hashed
      const hashedPin = await bcrypt.hash(pin, 10);
      await firestore.collection("users").doc(userId).update({ safetyPin: hashedPin });
      console.log(`[SOS] Migrated plain-text PIN to bcrypt for user ${userId}`);
    }
  }

  if (!pinMatch) {
    await incidentRef.collection("pinAttempts").add({
      attemptedAt: new Date().toISOString(),
      success: false,
    });

    return { success: false, message: "Invalid PIN" };
  }

  await incidentRef.update({
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
  });

  stopEscalation(incidentId);

  console.log(`[SOS] Incident cancelled: ${incidentId}`);

  await incidentRef.collection("pinAttempts").add({
    attemptedAt: new Date().toISOString(),
    success: true,
  });

  // Notify guardians that user is safe
  notifyGuardians(userId, "sos_cancelled", { incidentId }).catch((err) =>
    console.error("[SOS] Guardian cancel notification failed:", err)
  );

  // Emit real-time WebSocket cancellation
  emitSOSCancelled(userId, incidentId);

  // Send safe SMS to all guardians (non-blocking)
  sendSafeSMSToGuardians(userId).catch((err) =>
    console.error("[SOS] Safe SMS failed:", err)
  );

  return { success: true, message: "Incident cancelled successfully" };
};

/**
 * 📋 Get Incident by ID
 */
export const getIncidentById = async (incidentId: string) => {
  try {
    const incidentDoc = await firestore.collection("incidents").doc(incidentId).get();
    return incidentDoc.exists ? incidentDoc.data() : null;
  } catch (err) {
    console.error(`[SOS] Failed to fetch incident: ${incidentId}`, err);
    return null;
  }
};

/**
 * 📋 Get All Incidents for a User
 */
export const getIncidentsByUser = async (userId: string) => {
  try {
    const snapshot = await firestore
      .collection("incidents")
      .where("userId", "==", userId)
      .get();

    const incidents = snapshot.docs.map((doc) => doc.data());

    // Sort in-memory (newest first) to avoid Firestore composite index requirement
    incidents.sort((a: any, b: any) =>
      (b.createdAt || "").localeCompare(a.createdAt || "")
    );

    return incidents;
  } catch (err) {
    console.error(`[SOS] Failed to fetch incidents for userId: ${userId}`, err);
    return [];
  }
};

/**
 * 🔁 Update Escalation Stage
 */
export const updateEscalationStage = async (
  incidentId: string,
  stage: number
) => {
  try {
    const incidentRef = firestore.collection("incidents").doc(incidentId);
    const incidentDoc = await incidentRef.get();

    if (!incidentDoc.exists) {
      return { success: false, message: "Incident not found" };
    }

    const incidentData = incidentDoc.data();

    if (incidentData?.status !== "active") {
      return { success: false, message: "Incident not active" };
    }

    await incidentRef.update({
      escalationStage: stage,
      escalationUpdatedAt: new Date().toISOString(),
    });

    console.log(`[ESCALATION] Incident ${incidentId} escalated to stage ${stage}`);

    return { success: true, message: `Escalated to stage ${stage}` };
  } catch (err) {
    console.error(`[ESCALATION] Failed to update escalation`, err);
    return { success: false, message: "Escalation update failed" };
  }
};

/**
 * 📍 Attach Location Snapshot to Incident
 */
export const attachLocationToIncident = async (
  incidentId: string,
  latitude: number,
  longitude: number
) => {
  try {
    const incidentRef = firestore.collection("incidents").doc(incidentId);
    const incidentDoc = await incidentRef.get();

    if (!incidentDoc.exists) return;

    await incidentRef.collection("locationSnapshots").add({
      latitude,
      longitude,
      recordedAt: new Date().toISOString(),
    });

    // Also update the incident's latest coordinates
    await incidentRef.update({
      latitude,
      longitude,
      locationUpdatedAt: new Date().toISOString(),
    }).catch(() => {});

    console.log(`[LOCATION] Snapshot attached to incident: ${incidentId}`);
  } catch (err) {
    console.error(`[LOCATION] Failed to attach location`, err);
  }
};

/**
 * 🏁 Resolve Incident
 */
export const resolveIncident = async (
  incidentId: string,
  resolvedBy: string
) => {
  try {
    const incidentRef = firestore.collection("incidents").doc(incidentId);
    const incidentDoc = await incidentRef.get();

    if (!incidentDoc.exists) {
      return { success: false, message: "Incident not found" };
    }

    const incidentData = incidentDoc.data();

    if (incidentData?.status === "resolved") {
      return { success: false, message: "Incident already resolved" };
    }

    await incidentRef.update({
      status: "resolved",
      resolvedAt: new Date().toISOString(),
      resolvedBy: resolvedBy,
    });

    stopEscalation(incidentId);

    // Notify guardians via Firestore + push
    notifyGuardians(incidentData?.userId, "sos_resolved", { incidentId }).catch((err) =>
      console.error("[SOS] Guardian resolve notification failed:", err)
    );

    // Emit real-time WebSocket resolution
    emitSOSResolved(incidentData?.userId, incidentId);

    // Send "user is safe" SMS to all guardians (non-blocking, same as cancel)
    if (incidentData?.userId) {
      sendSafeSMSToGuardians(incidentData.userId).catch((err) =>
        console.error("[SOS] Safe SMS on resolve failed:", err)
      );
    }

    console.log(`[SOS] Incident resolved: ${incidentId}`);

    return { success: true, message: "Incident resolved successfully" };
  } catch (err) {
    console.error(`[SOS] Failed to resolve incident`, err);
    return { success: false, message: "Failed to resolve incident" };
  }
};

/**
 * 📞 Trigger Twilio SMS + sequential calls to all guardians.
 * Uses unified getAllGuardianPhones() to resolve from both in-app and external guardians.
 * This runs asynchronously (fire-and-forget) to not block the SOS response.
 */
async function triggerTwilioImmediateAlerts(
  userId: string,
  userName: string,
  incidentId: string,
  guardianPhones: string[],
  lat: number | null,
  lng: number | null
): Promise<void> {
  console.log(`[SOS-SMS] ═══════════════════════════════════════════`);
  console.log(`[SOS-SMS] Incident: ${incidentId}`);
  console.log(`[SOS-SMS] User: ${userName}`);
  console.log(`[SOS-SMS] Location: lat=${lat}, lng=${lng}`);
  console.log(`[SOS-SMS] Guardian phones: [${guardianPhones.join(', ')}]`);

  if (guardianPhones.length === 0) {
    console.warn("[SOS-SMS] ⚠️ No guardian phones — SMS will NOT be sent");
    return;
  }

  // ── STEP 1: SEND SMS IMMEDIATELY (highest priority) ─────────────────────
  // This is the MOST important step — do it FIRST before any Firestore patches.
  try {
    console.log(`[SOS-SMS] Sending alert SMS to ${guardianPhones.length} guardian(s)...`);
    const smsResult = await sendSOSToAllGuardians(
      guardianPhones,
      userName,
      lat ?? 0,
      lng ?? 0
    );
    console.log(`[SOS-SMS] ✅ SMS Result: ${smsResult.sent} sent, ${smsResult.failed} failed`);

    // Patch incident with SMS status (non-critical)
    firestore.collection("incidents").doc(incidentId).update({
      smsSent: smsResult.sent,
      smsFailed: smsResult.failed,
      smsAlertSent: smsResult.sent > 0,
      smsAlertSentAt: smsResult.sent > 0 ? new Date().toISOString() : null,
      guardianPhones,
    }).catch(() => {});
  } catch (smsErr) {
    console.error("[SOS-SMS] ❌ SMS sending failed:", smsErr);
  }

  // ── STEP 2: VOICE CALLS (secondary, non-blocking) ──────────────────────
  try {
    console.log(`[SOS-SMS] Starting sequential calls to ${guardianPhones.length} guardian(s)...`);
    const callResult = await callGuardiansSequentially(
      guardianPhones,
      userName,
      lat ?? 0,
      lng ?? 0
    );
    console.log(`[SOS-SMS] Calls: ${callResult.called} attempted, ${callResult.answered.length} placed`);

    firestore.collection("incidents").doc(incidentId).update({
      callsAttempted: callResult.called,
      callsPlaced: callResult.answered.length,
      callCompletedAt: new Date().toISOString(),
    }).catch(() => {});
  } catch (callErr) {
    console.error("[SOS-SMS] Calls failed:", callErr);
  }

  console.log(`[SOS-SMS] ═══════════════════════════════════════════`);
}

/**
 * 🔁 Ensure initial SMS + call rotation has started for an active incident.
 * Useful when /sos/trigger returns an existing active incident (idempotent triggers).
 */
export async function ensureInitialAlertsStarted(
  userId: string,
  incidentId: string
): Promise<void> {
  try {
    const incRef = firestore.collection("incidents").doc(incidentId);
    const incDoc = await incRef.get();
    if (!incDoc.exists) return;

    const incData: any = incDoc.data();
    if (incData?.status !== "active") return;

    // If we already sent at least one SMS, don't spam guardians.
    if (incData?.smsAlertSent === true && (incData?.smsSent || 0) > 0) return;

    // Resolve user name, phones, and location
    const [userDoc, phones] = await Promise.all([
      firestore.collection("users").doc(userId).get().catch(() => null),
      getAllGuardianPhones(userId).catch(() => [] as string[]),
    ]);
    const userName = userDoc?.exists ? userDoc.data()?.name || "Unknown" : "Unknown";

    let lat = incData?.latitude || null;
    let lng = incData?.longitude || null;
    if (!lat || !lng) {
      try {
        const locDoc = await firestore.collection("live_locations").doc(userId).get();
        if (locDoc.exists) {
          lat = locDoc.data()?.lat || null;
          lng = locDoc.data()?.lng || null;
        }
      } catch {}
    }

    triggerTwilioImmediateAlerts(userId, userName, incidentId, phones, lat, lng).catch(() => {});
  } catch (err) {
    console.error("[SOS] ensureInitialAlertsStarted error:", err);
  }
}

/**
 * ✅ Send "user is safe" SMS to all guardians when SOS is cancelled.
 * Uses unified phone resolution.
 */
async function sendSafeSMSToGuardians(userId: string): Promise<void> {
  try {
    const userDoc = await firestore.collection("users").doc(userId).get();
    const userName = userDoc.exists ? userDoc.data()?.name || "User" : "User";

    const phones = await getAllGuardianPhones(userId);
    for (const phone of phones) {
      sendSafeSMS(phone, userName).catch(() => {});
    }
  } catch (err) {
    console.error("[SOS] sendSafeSMSToGuardians error:", err);
  }
}