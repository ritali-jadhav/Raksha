import { Router } from "express";
import { firestore } from "../config/firebase";
import { requireAuth, getAuthUser } from "../middleware/auth";
import { createIncident } from "../services/sosService";
import { emitToUser } from "../services/socketManager";

const router = Router();
router.use(requireAuth);

/**
 * POST /checkin/timer  — start a dead-man's switch timer
 * Body: { durationMinutes: number, label?: string }
 */
router.post("/timer", async (req, res) => {
    try {
        const { userId } = getAuthUser(req);
        const { durationMinutes, label } = req.body;
        if (!durationMinutes || durationMinutes < 1) {
            return res.status(400).json({ error: "durationMinutes must be >= 1" });
        }
        const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
        const doc = await firestore.collection("checkin_timers").add({
            userId,
            label: label || `${durationMinutes} min timer`,
            durationMinutes,
            expiresAt,
            status: "active",
            createdAt: new Date().toISOString(),
        });
        return res.json({ success: true, timerId: doc.id, expiresAt });
    } catch (e) {
        return res.status(500).json({ error: "Failed to create timer" });
    }
});

/**
 * POST /checkin/confirm  — user checks in (cancels timer)
 */
router.post("/confirm", async (req, res) => {
    try {
        const { userId } = getAuthUser(req);
        const { timerId } = req.body;
        const ref = firestore.collection("checkin_timers").doc(timerId);
        const doc = await ref.get();
        if (!doc.exists || doc.data()?.userId !== userId) {
            return res.status(404).json({ error: "Timer not found" });
        }
        await ref.update({ status: "confirmed", confirmedAt: new Date().toISOString() });
        return res.json({ success: true });
    } catch (e) {
        return res.status(500).json({ error: "Failed to confirm" });
    }
});

/**
 * GET /checkin/active  — get active timers for user
 */
router.get("/active", async (req, res) => {
    try {
        const { userId } = getAuthUser(req);
        const snap = await firestore.collection("checkin_timers")
            .where("userId", "==", userId)
            .where("status", "==", "active")
            .get();
        const timers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, timers });
    } catch (e) {
        return res.status(500).json({ error: "Failed to fetch timers" });
    }
});

/**
 * POST /checkin/cancel  — manually cancel a timer
 */
router.post("/cancel", async (req, res) => {
    try {
        const { userId } = getAuthUser(req);
        const { timerId } = req.body;
        const ref = firestore.collection("checkin_timers").doc(timerId);
        const doc = await ref.get();
        if (!doc.exists || doc.data()?.userId !== userId) {
            return res.status(404).json({ error: "Timer not found" });
        }
        await ref.update({ status: "cancelled" });
        return res.json({ success: true });
    } catch (e) {
        return res.status(500).json({ error: "Failed to cancel" });
    }
});

export default router;
