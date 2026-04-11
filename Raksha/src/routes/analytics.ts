import { Router } from "express";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

const SAFE_ROUTE_URL = process.env.SAFE_ROUTE_URL || "http://127.0.0.1:8000";

/**
 * GET /analytics/crime-trends?city=Mumbai
 * Proxies to Python service
 */
router.get("/crime-trends", async (req, res) => {
    try {
        const city = (req.query.city as string) || "";
        const url = `${SAFE_ROUTE_URL}/crime-trends${city ? `?city=${encodeURIComponent(city)}` : ""}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) return res.status(r.status).json({ error: "Analytics service error" });
        const data = await r.json();
        return res.json(data);
    } catch (e) {
        return res.status(503).json({ error: "Analytics service unavailable" });
    }
});

/**
 * GET /analytics/top-cities
 */
router.get("/top-cities", async (req, res) => {
    try {
        const url = `${SAFE_ROUTE_URL}/top-cities`;
        const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) return res.status(r.status).json({ error: "Analytics service error" });
        const data = await r.json();
        return res.json(data);
    } catch (e) {
        return res.status(503).json({ error: "Analytics service unavailable" });
    }
});

export default router;
