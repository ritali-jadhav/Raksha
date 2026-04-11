import webPush from "web-push";
import { firestore } from "../config/firebase";

// Generate VAPID keys:  npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@raksha.app";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log("[PUSH] Web Push configured with VAPID keys");
} else {
  console.warn("[PUSH] VAPID keys not configured — push notifications disabled");
}

/**
 * Save push subscription for a user
 */
export async function savePushSubscription(
  userId: string,
  subscription: webPush.PushSubscription
): Promise<void> {
  await firestore.collection("push_subscriptions").doc(userId).set(
    {
      userId,
      subscription: JSON.stringify(subscription),
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  console.log(`[PUSH] Subscription saved for user ${userId}`);
}

/**
 * Remove push subscription for a user
 */
export async function removePushSubscription(userId: string): Promise<void> {
  await firestore.collection("push_subscriptions").doc(userId).delete();
  console.log(`[PUSH] Subscription removed for user ${userId}`);
}

/**
 * Send push notification to a specific user
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data: Record<string, any> = {},
  urgency: "very-low" | "low" | "normal" | "high" = "normal"
): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;

  try {
    const doc = await firestore
      .collection("push_subscriptions")
      .doc(userId)
      .get();

    if (!doc.exists) return false;

    const subData = doc.data();
    if (!subData?.subscription) return false;

    const subscription = JSON.parse(subData.subscription);

    const payload = JSON.stringify({
      title,
      body,
      icon: "/shield-icon.png",
      badge: "/shield-badge.png",
      tag: data.tag || "raksha-notification",
      data: {
        ...data,
        url: data.url || "/",
        timestamp: new Date().toISOString(),
      },
      actions: data.actions || [],
      requireInteraction: urgency === "high",
      vibrate: urgency === "high" ? [200, 100, 200, 100, 200] : [200, 100, 200],
    });

    await webPush.sendNotification(subscription, payload, {
      urgency,
      TTL: urgency === "high" ? 86400 : 3600,
    });

    console.log(`[PUSH] Sent to ${userId}: ${title}`);
    return true;
  } catch (err: any) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription expired or invalid — remove it
      await removePushSubscription(userId);
      console.log(`[PUSH] Removed expired subscription for ${userId}`);
    } else {
      console.error(`[PUSH] Failed to send to ${userId}:`, err.message);
    }
    return false;
  }
}

/**
 * Send push notification to all guardians of a user
 */
export async function sendPushToGuardians(
  userId: string,
  title: string,
  body: string,
  data: Record<string, any> = {},
  urgency: "very-low" | "low" | "normal" | "high" = "normal"
): Promise<number> {
  try {
    const { getGuardiansForUser } = await import("./guardianService");
    const guardians = await getGuardiansForUser(userId);

    let sent = 0;
    for (const guardian of guardians) {
      const guardianId = (guardian as any).guardianId;
      const result = await sendPushToUser(guardianId, title, body, data, urgency);
      if (result) sent++;
    }

    console.log(`[PUSH] Sent to ${sent}/${guardians.length} guardians of ${userId}`);
    return sent;
  } catch (err) {
    console.error("[PUSH] Failed to send to guardians:", err);
    return 0;
  }
}

/**
 * Get VAPID public key for client subscription
 */
export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}
