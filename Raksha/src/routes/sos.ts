import { Router } from "express";
import multer from "multer";
import {
  verifyPinAndCancelIncident,
  createIncident,
  getIncidentById,
  getIncidentsByUser,
  resolveIncident,
  attachLocationToIncident,
  attachMediaToIncident,
} from "../services/sosService";
import { uploadAndStoreEvidence } from "../services/mediaService";
import { checkGeofenceBreach } from "../services/geofenceService";
import { updateLocation } from "../services/locationService";
import { firestore } from "../config/firebase";
import { requireAuth, getAuthUser } from "../middleware/auth";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// All SOS routes require authentication
router.use(requireAuth);

/**
 * 🔴 Trigger SOS manually
 * userId is taken from the authenticated token.
 * Accepts optional latitude, longitude for immediate location capture.
 */
router.post("/trigger", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);
    const { triggerType, latitude, longitude } = req.body;

    // Prevent duplicate active incidents
    const existingSnapshot = await firestore
      .collection("incidents")
      .where("userId", "==", userId)
      .where("status", "==", "active")
      .limit(1)
      .get();

    if (!existingSnapshot.empty) {
      const existingDoc = existingSnapshot.docs[0];
      return res.json({
        success: true,
        incidentId: existingDoc.id,
        message: "Active incident already exists",
        existing: true,
      });
    }

    const incidentId = await createIncident(
      userId,
      triggerType || "manual",
      latitude,
      longitude
    );

    return res.json({ success: true, incidentId });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to trigger SOS" });
  }
});

/**
 * ✅ Verify PIN & Cancel Incident
 */
router.post("/verify-pin", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);
    const { incidentId, pin } = req.body;

    if (!incidentId || !pin) {
      return res.status(400).json({ error: "Missing incidentId or pin." });
    }

    const result = await verifyPinAndCancelIncident(userId, incidentId, pin);
    return res.json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * 📍 Location Update + Auto Geofence Check
 */
router.post("/location-update", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);
    const { lat, lng } = req.body;

    if (lat == null || lng == null) {
      return res.status(400).json({ error: "Missing lat or lng" });
    }

    await updateLocation(userId, lat, lng);

    const breachResult = await checkGeofenceBreach(userId, lat, lng);

    if (breachResult.breached) {
      const incidentId = await createIncident(userId, "geofence_breach", lat, lng);
      await attachLocationToIncident(incidentId, lat, lng);

      console.log(
        `[AUTO] Geofence breach triggered SOS: ${incidentId} for user ${userId}`
      );
    }

    res.json({ success: true, breachResult });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Location update failed" });
  }
});

/**
 * 📎 Attach media to an active SOS incident.
 * Uploads file to Cloudinary, stores evidence in Firestore,
 * updates the incident with mediaUrl, and triggers follow-up SMS.
 */
router.post("/attach-media", upload.single("file"), async (req: any, res: any) => {
  try {
    const { userId } = getAuthUser(req);
    const { incidentId, type } = req.body;

    if (!incidentId || !req.file) {
      return res.status(400).json({ error: "Missing incidentId or file" });
    }

    const mediaType = type || "image";

    // Upload to Cloudinary + store in evidence collection (with retry)
    const mediaUrl = await uploadAndStoreEvidence(
      userId,
      incidentId,
      req.file.buffer,
      mediaType
    );

    if (!mediaUrl) {
      return res.status(500).json({ error: "Media upload failed after retries" });
    }

    // Attach to incident and trigger follow-up SMS
    const result = await attachMediaToIncident(incidentId, mediaUrl, mediaType);

    return res.json({
      success: result.success,
      mediaUrl,
      message: result.message,
    });
  } catch (error) {
    console.error("[SOS] attach-media error:", error);
    return res.status(500).json({ error: "Failed to attach media" });
  }
});

/**
 * 📋 Get all incidents for the authenticated user
 */
router.get("/incidents", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);

    const incidents = await getIncidentsByUser(userId);
    return res.json({ success: true, incidents });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to fetch incidents" });
  }
});

/**
 * 📋 Get single incident by ID
 */
router.get("/incident/:incidentId", async (req, res) => {
  try {
    const { incidentId } = req.params;

    if (!incidentId) {
      return res.status(400).json({ error: "Missing incidentId" });
    }

    const incident = await getIncidentById(incidentId);

    if (!incident) {
      return res.status(404).json({ error: "Incident not found" });
    }

    return res.json({ success: true, incident });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to fetch incident" });
  }
});

/**
 * 🏁 Resolve an incident
 */
router.post("/resolve", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);
    const { incidentId } = req.body;

    if (!incidentId) {
      return res.status(400).json({ error: "Missing incidentId" });
    }

    const result = await resolveIncident(incidentId, userId);
    return res.json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to resolve incident" });
  }
});

export default router;