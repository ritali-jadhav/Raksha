import { Router } from "express";
import { requireAuth, getAuthUser } from "../middleware/auth";
import {
  savePushSubscription,
  removePushSubscription,
  getVapidPublicKey,
} from "../services/webPushService";

const router = Router();

/**
 * GET /push/vapid-key
 * Get the VAPID public key (needed by the client to subscribe)
 */
router.get("/vapid-key", (_req, res) => {
  const key = getVapidPublicKey();
  if (!key) {
    return res.status(503).json({ error: "Push notifications not configured" });
  }
  res.json({ success: true, publicKey: key });
});

// All other push routes require authentication
router.use(requireAuth);

/**
 * POST /push/subscribe
 * Register a push subscription for the authenticated user
 */
router.post("/subscribe", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);
    const { subscription } = req.body;

    if (!subscription) {
      return res.status(400).json({ error: "subscription required" });
    }

    await savePushSubscription(userId, subscription);
    res.json({ success: true, message: "Push subscription saved" });
  } catch (err) {
    console.error("[PUSH] Subscribe error:", err);
    res.status(500).json({ error: "Failed to save subscription" });
  }
});

/**
 * POST /push/unsubscribe
 * Remove push subscription for the authenticated user
 */
router.post("/unsubscribe", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);
    await removePushSubscription(userId);
    res.json({ success: true, message: "Push subscription removed" });
  } catch (err) {
    console.error("[PUSH] Unsubscribe error:", err);
    res.status(500).json({ error: "Failed to remove subscription" });
  }
});

export default router;
