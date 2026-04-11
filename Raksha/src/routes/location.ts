import { Router } from "express";
import { updateLocation } from "../services/locationService";
import { firestore } from "../config/firebase";
import { requireAuth, getAuthUser } from "../middleware/auth";

const router = Router();

// All location routes require authentication
router.use(requireAuth);

/**
 * 📍 Update Live Location
 */
router.post("/update", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);
    const { lat, lng } = req.body;

    if (lat == null || lng == null) {
      return res.status(400).json({ error: "Missing lat or lng" });
    }

    await updateLocation(userId, lat, lng);

    res.json({ success: true });
  } catch (error) {
    console.error("[LOCATION] Update error:", error);
    res.status(500).json({ error: "Location update failed" });
  }
});

/**
 * ❤️ Heartbeat Ping
 */
router.post("/heartbeat", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);

    await firestore.collection("users").doc(userId).set(
      {
        lastHeartbeat: new Date().toISOString(),
      },
      { merge: true }
    );

    res.json({ success: true });
  } catch (error) {
    console.error("[HEARTBEAT] Error:", error);
    res.status(500).json({ error: "Heartbeat failed" });
  }
});

export default router;