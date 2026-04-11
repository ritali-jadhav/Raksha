import { Router } from "express";
import { firestore } from "../config/firebase";
import { requireAuth, getAuthUser } from "../middleware/auth";
import { haversineDistance } from "../utils/distance";

const router = Router();
router.use(requireAuth);

/**
 * POST /journey/start
 * Body: { destination: string, destLat: number, destLng: number, etaMinutes: number }
 */
router.post("/start", async (req, res) => {
    try {
        const { userId } = getAuthUser(req);
        const { destination, destLat, destLng, etaMinutes } = req.body;
        if (!destLat || !destLng || !etaMinutes) {
            return res.status(400).json({ error: "Missing destLat, destLng, or etaMinutes" });
        }
        const etaAt = new Date(Date.now() + etaMinutes * 60 * 1000).toISOString();
        const doc = await firestore.collection("journeys").add({
            userId,
            destination: destination || "Destination",
            destLat,
            destLng,
            etaMinutes,
            etaAt,
            status: "active",
            createdAt: new Date().toISOString(),
        });
        return res.json({ success: true, journeyId: doc.id, etaAt });
    } catch (e) {
        return res.status(500).json({ error: "Failed to start journey" });
    }
});

/**
 * POST /journey/arrived  — mark journey complete
 */
router.post("/arrived", async (req, res) => {
    try {
        const { userId } = getAuthUser(req);
        const { journeyId } = req.body;
        const ref = firestore.collection("journeys").doc(journeyId);
        const doc = await ref.get();
        if (!doc.exists || doc.data()?.userId !== userId) {
            return res.status(404).json({ error: "Journey not found" });
        }
        await ref.update({ status: "arrived", arrivedAt: new Date().toISOString() });
        return res.json({ success: true });
    } catch (e) {
        return res.status(500).json({ error: "Failed to mark arrived" });
    }
});

/**
 * GET /journey/active
 */
router.get("/active", async (req, res) => {
    try {
        const { userId } = getAuthUser(req);
        const snap = await firestore.collection("journeys")
            .where("userId", "==", userId)
            .where("status", "==", "active")
            .get();
        const journeys = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, journeys });
    } catch (e) {
        return res.status(500).json({ error: "Failed to fetch journeys" });
    }
});

/**
 * POST /journey/cancel
 */
router.post("/cancel", async (req, res) => {
    try {
        const { userId } = getAuthUser(req);
        const { journeyId } = req.body;
        const ref = firestore.collection("journeys").doc(journeyId);
        const doc = await ref.get();
        if (!doc.exists || doc.data()?.userId !== userId) {
            return res.status(404).json({ error: "Journey not found" });
        }
        await ref.update({ status: "cancelled" });
        return res.json({ success: true });
    } catch (e) {
        return res.status(500).json({ error: "Failed to cancel journey" });
    }
});

export default router;
