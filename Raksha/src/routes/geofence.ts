import { Router } from "express";
import { firestore } from "../config/firebase";
import { requireAuth, getAuthUser } from "../middleware/auth";

const router = Router();

// All geofence routes require authentication
router.use(requireAuth);

/**
 * 📍 Create a geofence (safe zone) for the authenticated user
 */
router.post("/create", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);
    const { centerLat, centerLng, radiusMeters, name } = req.body;

    if (centerLat == null || centerLng == null || radiusMeters == null) {
      return res
        .status(400)
        .json({ error: "Missing required fields: centerLat, centerLng, radiusMeters" });
    }

    if (typeof centerLat !== "number" || typeof centerLng !== "number" || typeof radiusMeters !== "number") {
      return res
        .status(400)
        .json({ error: "centerLat, centerLng, and radiusMeters must be numbers" });
    }

    if (radiusMeters <= 0) {
      return res.status(400).json({ error: "radiusMeters must be positive" });
    }

    const doc = await firestore.collection("geofences").add({
      protectedId: userId,
      centerLat,
      centerLng,
      radiusMeters,
      name: name || null,
      createdAt: new Date().toISOString(),
    });

    res.json({ success: true, id: doc.id });
  } catch (error) {
    console.error("[GEOFENCE] Create error:", error);
    res.status(500).json({ error: "Failed to create geofence" });
  }
});

/**
 * 📋 List all geofences for the authenticated user
 */
router.get("/list", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);

    const snapshot = await firestore
      .collection("geofences")
      .where("protectedId", "==", userId)
      .get();

    const geofences = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({ success: true, geofences });
  } catch (error) {
    console.error("[GEOFENCE] List error:", error);
    res.status(500).json({ error: "Failed to list geofences" });
  }
});

/**
 * 🗑️ Delete a geofence (only owner can delete)
 */
router.delete("/:id", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);
    const { id } = req.params;

    const docRef = firestore.collection("geofences").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Geofence not found" });
    }

    const data = doc.data()!;

    // Only the owner can delete their geofence
    if (data.protectedId !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    await docRef.delete();

    res.json({ success: true, message: "Geofence deleted" });
  } catch (error) {
    console.error("[GEOFENCE] Delete error:", error);
    res.status(500).json({ error: "Failed to delete geofence" });
  }
});

export default router;
