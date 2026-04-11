import { Router } from "express";
import { firestore } from "../config/firebase";
import { requireAuth, getAuthUser } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

const INCIDENT_TYPES = ['harassment', 'theft', 'assault', 'suspicious', 'accident', 'other'];

/**
 * POST /community/report  — crowd-source an incident pin
 */
router.post("/report", async (req, res) => {
    try {
        const { userId } = getAuthUser(req);
        const { lat, lng, type, description } = req.body;
        if (!lat || !lng || !type) {
            return res.status(400).json({ error: "Missing lat, lng, or type" });
        }
        if (!INCIDENT_TYPES.includes(type)) {
            return res.status(400).json({ error: `type must be one of: ${INCIDENT_TYPES.join(', ')}` });
        }
        const doc = await firestore.collection("community_incidents").add({
            userId,
            lat,
            lng,
            type,
            description: description || '',
            upvotes: 0,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h TTL
        });
        return res.json({ success: true, id: doc.id });
    } catch (e) {
        return res.status(500).json({ error: "Failed to report incident" });
    }
});

/**
 * GET /community/nearby?lat=&lng=&radiusKm=
 */
router.get("/nearby", async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat as string);
        const lng = parseFloat(req.query.lng as string);
        const radiusKm = parseFloat((req.query.radiusKm as string) || '5');
        if (isNaN(lat) || isNaN(lng)) {
            return res.status(400).json({ error: "Missing lat/lng" });
        }
        // Simple bounding box filter (Firestore doesn't support geo queries natively)
        const degPerKm = 1 / 111;
        const latDelta = radiusKm * degPerKm;
        const lngDelta = radiusKm * degPerKm / Math.cos(lat * Math.PI / 180);

        const snap = await firestore.collection("community_incidents")
            .where("lat", ">=", lat - latDelta)
            .where("lat", "<=", lat + latDelta)
            .get();

        const now = new Date();
        const incidents = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter((d: any) => {
                const lngOk = d.lng >= lng - lngDelta && d.lng <= lng + lngDelta;
                const notExpired = new Date(d.expiresAt) > now;
                return lngOk && notExpired;
            });

        return res.json({ success: true, incidents });
    } catch (e) {
        return res.status(500).json({ error: "Failed to fetch incidents" });
    }
});

/**
 * POST /community/upvote/:id
 */
router.post("/upvote/:id", async (req, res) => {
    try {
        const ref = firestore.collection("community_incidents").doc(req.params.id);
        await ref.update({ upvotes: (await ref.get()).data()?.upvotes + 1 || 1 });
        return res.json({ success: true });
    } catch (e) {
        return res.status(500).json({ error: "Failed to upvote" });
    }
});

export default router;
