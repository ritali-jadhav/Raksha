import { firestore } from "../config/firebase";
import { sendPushToGuardians } from "./webPushService";

/**
 * 🛡️ Get confirmed guardians for a protected user
 */
export async function getGuardiansForUser(userId: string) {
  const snapshot = await firestore
    .collection("guardian_links")
    .where("protectedId", "==", userId)
    .where("status", "==", "confirmed")
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

/**
 * 🛡️ Get protected users for a guardian
 */
export async function getProtectedUsersForGuardian(guardianId: string) {
  const snapshot = await firestore
    .collection("guardian_links")
    .where("guardianId", "==", guardianId)
    .where("status", "==", "confirmed")
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

/**
 * 🔔 Notify all confirmed guardians of a user about an event.
 * Stores notifications in Firestore `guardian_notifications` collection
 * so they can be polled or pushed to the guardian's device.
 */
export async function notifyGuardians(
  userId: string,
  eventType: "sos_triggered" | "sos_cancelled" | "sos_resolved" | "geofence_breach",
  details: Record<string, unknown> = {}
) {
  try {
    const guardians = await getGuardiansForUser(userId);

    if (guardians.length === 0) {
      console.log(`[GUARDIAN] No guardians to notify for user ${userId}`);
      return { notified: 0 };
    }

    // Fetch user info for the notification
    const userDoc = await firestore.collection("users").doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : null;
    const userName = userData?.name || "Unknown User";

    const messages: Record<string, string> = {
      sos_triggered: `🚨 ${userName} triggered an SOS alert!`,
      sos_cancelled: `✅ ${userName} is safe. SOS was cancelled.`,
      sos_resolved: `✅ ${userName}'s incident has been resolved.`,
      geofence_breach: `⚠️ ${userName} has left their safe zone!`,
    };

    const batch = firestore.batch();
    const now = new Date().toISOString();

    for (const guardian of guardians) {
      const guardianId = (guardian as any).guardianId;

      const notifRef = firestore.collection("guardian_notifications").doc();
      batch.set(notifRef, {
        guardianId,
        protectedUserId: userId,
        protectedUserName: userName,
        eventType,
        message: messages[eventType],
        read: false,
        createdAt: now,
        ...details,
      });
    }

    await batch.commit();

    console.log(
      `[GUARDIAN] Notified ${guardians.length} guardian(s) of ${eventType} for user ${userId}`
    );

    // Also send Web Push notifications
    const pushTitles: Record<string, string> = {
      sos_triggered: "🚨 EMERGENCY SOS",
      sos_cancelled: "✅ User is Safe",
      sos_resolved: "✅ Incident Resolved",
      geofence_breach: "⚠️ Safe Zone Alert",
    };

    const urgency = (eventType === "sos_triggered" || eventType === "geofence_breach")
      ? "high" as const
      : "normal" as const;

    sendPushToGuardians(
      userId,
      pushTitles[eventType] || "Raksha Alert",
      messages[eventType],
      {
        tag: `raksha-${eventType}`,
        url: "/guardians",
        actions: eventType === "sos_triggered"
          ? [
              { action: "track", title: "📍 Track" },
              { action: "call", title: "📞 Call" },
            ]
          : [],
        ...details,
      },
      urgency
    ).catch((err) => console.error("[GUARDIAN] Push notification failed:", err));

    return { notified: guardians.length };
  } catch (error) {
    console.error("[GUARDIAN] Failed to notify guardians:", error);
    return { notified: 0 };
  }
}

/**
 * 📋 Get notifications for a guardian (newest first)
 */
export async function getGuardianNotifications(
  guardianId: string,
  limit: number = 50
) {
  const snapshot = await firestore
    .collection("guardian_notifications")
    .where("guardianId", "==", guardianId)
    .get();

  const notifications = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  // Sort in-memory (newest first) to avoid Firestore composite index requirement
  notifications.sort((a: any, b: any) =>
    (b.createdAt || "").localeCompare(a.createdAt || "")
  );

  return notifications.slice(0, limit);
}

/**
 * ✅ Mark a notification as read
 */
export async function markNotificationRead(notificationId: string) {
  await firestore
    .collection("guardian_notifications")
    .doc(notificationId)
    .update({ read: true, readAt: new Date().toISOString() });
}

/**
 * ✅ Mark all notifications as read for a guardian
 */
export async function markAllNotificationsRead(guardianId: string) {
  const snapshot = await firestore
    .collection("guardian_notifications")
    .where("guardianId", "==", guardianId)
    .where("read", "==", false)
    .get();

  const batch = firestore.batch();
  const now = new Date().toISOString();

  for (const doc of snapshot.docs) {
    batch.update(doc.ref, { read: true, readAt: now });
  }

  await batch.commit();

  return { marked: snapshot.size };
}

/**
 * 📊 Get full status dashboard for a guardian.
 * Returns all protected users with their current status,
 * live location, and active incidents.
 */
export async function getGuardianDashboard(guardianId: string) {
  const links = await getProtectedUsersForGuardian(guardianId);

  const dashboard: any[] = [];

  for (const link of links) {
    const protId = (link as any).protectedId;

    // User info
    const userDoc = await firestore.collection("users").doc(protId).get();
    const userData = userDoc.exists ? userDoc.data() : null;

    // Live location
    const locDoc = await firestore
      .collection("live_locations")
      .doc(protId)
      .get();
    const location = locDoc.exists ? locDoc.data() : null;

    // Active incidents
    const activeIncidents = await firestore
      .collection("incidents")
      .where("userId", "==", protId)
      .where("status", "==", "active")
      .get();

    const incidents = activeIncidents.docs.map((doc) => ({
      incidentId: doc.id,
      ...doc.data(),
    }));

    dashboard.push({
      linkId: link.id,
      protectedId: protId,
      name: userData?.name || "Unknown",
      email: userData?.email || null,
      phone: userData?.phone || null,
      lastHeartbeat: userData?.lastHeartbeat || null,
      location,
      hasActiveIncident: incidents.length > 0,
      activeIncidents: incidents,
    });
  }

  return dashboard;
}

// ====================================================================
//  EXTERNAL PHONE-ONLY GUARDIANS
// ====================================================================

/**
 * ➕ Add an external phone-only guardian (not an app user).
 * Stored in `guardian_phones` collection keyed by the protected user.
 */
export async function addExternalGuardian(
  userId: string,
  name: string,
  phone: string
) {
  // Normalize phone (ensure it starts with +)
  const normalizedPhone = phone.startsWith("+") ? phone : `+${phone}`;

  // Check duplicate
  const existing = await firestore
    .collection("guardian_phones")
    .where("userId", "==", userId)
    .where("phone", "==", normalizedPhone)
    .limit(1)
    .get();

  if (!existing.empty) {
    return { success: false, message: "This phone number is already added" };
  }

  const docRef = await firestore.collection("guardian_phones").add({
    userId,
    name: name.trim(),
    phone: normalizedPhone,
    createdAt: new Date().toISOString(),
  });

  console.log(`[GUARDIAN] External guardian added: ${normalizedPhone} for user ${userId}`);
  return { success: true, id: docRef.id };
}

/**
 * 📋 Get all external phone-only guardians for a user
 */
export async function getExternalGuardiansForUser(userId: string) {
  const snapshot = await firestore
    .collection("guardian_phones")
    .where("userId", "==", userId)
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

/**
 * ❌ Remove an external phone guardian
 */
export async function removeExternalGuardian(userId: string, guardianPhoneId: string) {
  const docRef = firestore.collection("guardian_phones").doc(guardianPhoneId);
  const doc = await docRef.get();

  if (!doc.exists) {
    return { success: false, message: "Guardian not found" };
  }

  const data = doc.data();
  if (data?.userId !== userId) {
    return { success: false, message: "Unauthorized" };
  }

  await docRef.delete();
  console.log(`[GUARDIAN] External guardian removed: ${guardianPhoneId}`);
  return { success: true };
}

/**
 * 📞 Get ALL guardian phone numbers for a user (unified).
 * Collects from both:
 *   1. In-app guardians (guardian_links → users/{guardianId}/phone)
 *   2. External phone-only guardians (guardian_phones collection)
 * Returns deduplicated phone list.
 */
export async function getAllGuardianPhones(userId: string): Promise<string[]> {
  const phones: string[] = [];

  // 1. In-app guardians
  try {
    const guardians = await getGuardiansForUser(userId);
    for (const g of guardians) {
      const gId = (g as any).guardianId;
      const gDoc = await firestore.collection("users").doc(gId).get();
      const phone = gDoc.exists ? gDoc.data()?.phone : null;
      if (phone) phones.push(phone);
    }
  } catch (err) {
    console.error("[GUARDIAN] Error fetching in-app guardian phones:", err);
  }

  // 2. External phone-only guardians
  try {
    const externalGuardians = await getExternalGuardiansForUser(userId);
    for (const eg of externalGuardians) {
      const phone = (eg as any).phone;
      if (phone) phones.push(phone);
    }
  } catch (err) {
    console.error("[GUARDIAN] Error fetching external guardian phones:", err);
  }

  // Deduplicate
  const unique = [...new Set(phones)];
  console.log(`[GUARDIAN] Resolved ${unique.length} phone(s) for user ${userId}`);
  return unique;
}
