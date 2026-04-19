import { firestore } from "../config/firebase";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { startEscalation, stopEscalation } from "./escalationService";
import { notifyGuardians, getAllGuardianPhones } from "./guardianService";
import { emitSOSTriggered, emitSOSCancelled, emitSOSResolved, emitLocationUpdate, emitMediaCaptured } from "./socketManager";
import { sendSOSToAllGuardians, callGuardiansSequentially, sendSafeSMS, sendMediaFollowUpSMS } from "./twilioService";

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
  // Prevent duplicate active incidents for this user
  const existingSnapshot = await firestore
    .collection("incidents")
    .where("userId", "==", userId)
    .where("status", "==", "active")
    .limit(1)
    .get();

  if (!existingSnapshot.empty) {
    const existingId = existingSnapshot.docs[0].id;
    console.log(`[SOS] Active incident already exists for user ${userId}: ${existingId}`);
    return existingId;
  }

  const incidentId = uuidv4();
  const now = new Date().toISOString();

  // Resolve all guardian phone numbers upfront for the incident record
  let guardianPhones: string[] = [];
  try {
    guardianPhones = await getAllGuardianPhones(userId);
  } catch (err) {
    console.error("[SOS] Failed to resolve guardian phones:", err);
  }

  // If no lat/lng provided, try to get from live_locations
  let lat = latitude;
  let lng = longitude;
  if (lat == null || lng == null) {
    try {
      const locDoc = await firestore.collection("live_locations").doc(userId).get();
      if (locDoc.exists) {
        lat = locDoc.data()?.lat;
        lng = locDoc.data()?.lng;
      }
    } catch {}
  }

  // Complete SOS event record in Firebase
  await firestore.collection("incidents").doc(incidentId).set({
    incidentId,
    userId,
    triggerType,
    status: "active",
    createdAt: now,
    timestamp: now,
    latitude: lat || null,
    longitude: lng || null,
    guardianPhones,
    mediaUrl: null,
    mediaType: null,
    escalationStage: 0,
  });

  startEscalation(incidentId);

  // Notify all guardians
  const eventType = triggerType === "geofence_breach" ? "geofence_breach" as const : "sos_triggered" as const;
  notifyGuardians(userId, eventType, { incidentId }).catch((err) =>
    console.error("[SOS] Guardian notification failed:", err)
  );

  // Emit real-time WebSocket event to guardians
  let userName = "Unknown";
  let userPhone: string | null = null;
  try {
    const userDoc = await firestore.collection("users").doc(userId).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      userName = userData?.name || "Unknown";
      userPhone = userData?.phone || null;
    }
    emitSOSTriggered(userId, incidentId, userName, triggerType, userPhone);
  } catch (err) {
    console.error("[SOS] Socket emit failed:", err);
  }

  // Twilio SMS + Calls to guardians (fire-and-forget, non-blocking)
  triggerTwilioAlerts(userId, userName, incidentId).catch((err) =>
    console.error("[SOS] Twilio alerts failed:", err)
  );

  console.log(`[SOS] Incident created: ${incidentId}`);

  return incidentId;
};

/**
 * 📎 Attach media to an existing incident and send follow-up SMS to guardians.
 * Called after Cloudinary upload completes.
 */
export const attachMediaToIncident = async (
  incidentId: string,
  mediaUrl: string,
  mediaType: "image" | "video" | "audio"
): Promise<{ success: boolean; message: string }> => {
  try {
    const incidentRef = firestore.collection("incidents").doc(incidentId);
    const incidentDoc = await incidentRef.get();

    if (!incidentDoc.exists) {
      return { success: false, message: "Incident not found" };
    }

    const incidentData = incidentDoc.data();
    const userId = incidentData?.userId;

    // Update incident with media URL
    await incidentRef.update({
      mediaUrl,
      mediaType,
      mediaUpdatedAt: new Date().toISOString(),
    });

    console.log(`[SOS] Media attached to incident ${incidentId}: ${mediaUrl}`);

    // Emit WebSocket event so guardian UI updates in real-time
    if (userId) {
      emitMediaCaptured(userId, incidentId, mediaUrl, mediaType);
    }

    // Send follow-up SMS with media link to all guardians (non-blocking)
    if (userId) {
      sendMediaFollowUp(userId, incidentId, mediaUrl).catch((err) =>
        console.error("[SOS] Follow-up SMS failed:", err)
      );
    }

    return { success: true, message: "Media attached" };
  } catch (err) {
    console.error("[SOS] attachMediaToIncident error:", err);
    return { success: false, message: "Failed to attach media" };
  }
};

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

    // Notify guardians
    notifyGuardians(incidentData?.userId, "sos_resolved", { incidentId }).catch((err) =>
      console.error("[SOS] Guardian resolve notification failed:", err)
    );

    // Emit real-time WebSocket resolution
    emitSOSResolved(incidentData?.userId, incidentId);

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
async function triggerTwilioAlerts(
  userId: string,
  userName: string,
  incidentId: string
): Promise<void> {
  try {
    // Use unified phone resolution (in-app + external guardians)
    const phones = await getAllGuardianPhones(userId);
    if (phones.length === 0) {
      console.log("[SOS] No guardian phone numbers available");
      return;
    }

    // Get last known location for SMS
    const locDoc = await firestore.collection("live_locations").doc(userId).get();
    const lat = locDoc.exists ? locDoc.data()?.lat || 0 : 0;
    const lng = locDoc.exists ? locDoc.data()?.lng || 0 : 0;

    // Get mediaUrl if already available
    const incDoc = await firestore.collection("incidents").doc(incidentId).get();
    const mediaUrl = incDoc.exists ? incDoc.data()?.mediaUrl : undefined;

    // Store guardian phones on the incident for logging
    await firestore.collection("incidents").doc(incidentId).update({
      guardianPhones: phones,
      smsInitiatedAt: new Date().toISOString(),
    }).catch(() => {});

    // 1. Send SMS to ALL guardians
    console.log(`[SOS] Sending SMS to ${phones.length} guardian(s)`);
    const smsResult = await sendSOSToAllGuardians(phones, userName, lat, lng, mediaUrl);

    await firestore.collection("incidents").doc(incidentId).update({
      smsSent: smsResult.sent,
      smsFailed: smsResult.failed,
    }).catch(() => {});

    // 2. Sequential calls to all guardians
    console.log(`[SOS] Starting sequential calls to ${phones.length} guardian(s)`);
    const callResult = await callGuardiansSequentially(phones, userName, lat, lng);

    await firestore.collection("incidents").doc(incidentId).update({
      callsAttempted: callResult.called,
      callsPlaced: callResult.answered.length,
      callCompletedAt: new Date().toISOString(),
    }).catch(() => {});

  } catch (err) {
    console.error("[SOS] triggerTwilioAlerts error:", err);
  }
}

/**
 * 📎 Send follow-up SMS with media link to all guardians.
 * Called after media is uploaded and attached to the incident.
 */
async function sendMediaFollowUp(
  userId: string,
  incidentId: string,
  mediaUrl: string
): Promise<void> {
  try {
    const userDoc = await firestore.collection("users").doc(userId).get();
    const userName = userDoc.exists ? userDoc.data()?.name || "User" : "User";

    const phones = await getAllGuardianPhones(userId);
    for (const phone of phones) {
      sendMediaFollowUpSMS(phone, userName, mediaUrl).catch(() => {});
    }

    // Log that follow-up was sent
    await firestore.collection("incidents").doc(incidentId).update({
      mediaFollowUpSent: true,
      mediaFollowUpAt: new Date().toISOString(),
    }).catch(() => {});
  } catch (err) {
    console.error("[SOS] sendMediaFollowUp error:", err);
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