import { Router, Request, Response } from "express";
import axios from "axios";

const router = Router();

// ─── Python microservice URL ───────────────────────────────────────────────────
const SAFE_ROUTE_API_URL = process.env.SAFE_ROUTE_API_URL || "http://localhost:5000";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Coordinate {
  lat: number;
  lng: number;
}

interface RouteRequestBody {
  source: Coordinate;
  destination: Coordinate;
}

// ─── POST /safe-route ─────────────────────────────────────────────────────────
// Bridge between the React Native app and the Python safe-route microservice.
// Validates inputs, proxies the request, normalises the response.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  try {
    const body: RouteRequestBody = req.body;

    // ── Input validation ──────────────────────────────────────────────────────
    const { source, destination } = body;

    if (!source || typeof source.lat !== "number" || typeof source.lng !== "number") {
      res.status(400).json({ error: "Invalid or missing source coordinates. Expected { lat: number, lng: number }" });
      return;
    }

    if (!destination || typeof destination.lat !== "number" || typeof destination.lng !== "number") {
      res.status(400).json({ error: "Invalid or missing destination coordinates. Expected { lat: number, lng: number }" });
      return;
    }

    if (source.lat < -90 || source.lat > 90 || source.lng < -180 || source.lng > 180) {
      res.status(400).json({ error: "Source coordinates out of valid range" });
      return;
    }

    if (destination.lat < -90 || destination.lat > 90 || destination.lng < -180 || destination.lng > 180) {
      res.status(400).json({ error: "Destination coordinates out of valid range" });
      return;
    }

    console.log(`[SAFE-ROUTE] Request: ${source.lat},${source.lng} → ${destination.lat},${destination.lng}`);

    // ── Call Python microservice ──────────────────────────────────────────────
    const pythonResponse = await axios.post(
      `${SAFE_ROUTE_API_URL}/route`,
      { source, destination },
      { timeout: 20_000, headers: { "Content-Type": "application/json" } }
    );

    const data = pythonResponse.data;

    // ── Handle error returned from Python ─────────────────────────────────────
    if (data.error) {
      console.warn(`[SAFE-ROUTE] Python returned error: ${data.error}`);
      res.status(422).json({ error: data.error });
      return;
    }

    // ── Validate expected shape ────────────────────────────────────────────────
    if (!data.path || !Array.isArray(data.path) || data.path.length === 0) {
      res.status(422).json({ error: "No route found between the given coordinates" });
      return;
    }

    console.log(`[SAFE-ROUTE] Success: ${data.path.length} points, ${data.distance} km, score ${data.safety_score}`);

    // ── Return to mobile app ──────────────────────────────────────────────────
    res.status(200).json({
      path: data.path,           // [{ lat, lng }, ...]
      distance: data.distance,   // km (number)
      safety_score: data.safety_score, // 0–1 (lower = safer)
    });

  } catch (err: any) {
    // ── Python service is down / network error ────────────────────────────────
    if (axios.isAxiosError(err)) {
      if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
        console.error("[SAFE-ROUTE] Python service is not reachable:", err.message);
        res.status(503).json({
          error: "Safe route service is currently unavailable. Please try again later.",
        });
        return;
      }
      if (err.code === "ECONNABORTED") {
        console.error("[SAFE-ROUTE] Python service timed out");
        res.status(504).json({ error: "Safe route service timed out. Please try again." });
        return;
      }
    }

    console.error("[SAFE-ROUTE] Unexpected error:", err);
    res.status(500).json({ error: "An unexpected error occurred while computing the route" });
  }
});

// ─── GET /safe-route/routes ────────────────────────────────────────────────────
// Proxy for the web frontend SafeRoute page.
// Query params: source, destination (address or "lat,lng"), hour
// ───────────────────────────────────────────────────────────────────────────────
router.get("/routes", async (req: Request, res: Response) => {
  try {
    const { source, destination, hour } = req.query;

    if (!source || !destination) {
      res.status(400).json({ error: "source and destination query params required" });
      return;
    }

    const params = new URLSearchParams({
      source: String(source),
      destination: String(destination),
      hour: String(hour || new Date().getHours()),
    });

    const pythonResponse = await axios.get(
      `${SAFE_ROUTE_API_URL}/routes?${params.toString()}`,
      { timeout: 15_000 }
    );

    res.status(200).json(pythonResponse.data);
  } catch (err: any) {
    if (axios.isAxiosError(err)) {
      if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
        res.status(503).json({ error: "Safe route service unavailable" });
        return;
      }
      if (err.code === "ECONNABORTED") {
        res.status(504).json({ error: "Safe route service timed out" });
        return;
      }
      // Forward Python service error response
      if (err.response) {
        res.status(err.response.status).json(err.response.data);
        return;
      }
    }
    console.error("[SAFE-ROUTE] GET /routes error:", err);
    res.status(500).json({ error: "Route computation failed" });
  }
});

// ─── GET /safe-route/risk-map ──────────────────────────────────────────────────
// Proxy for the web frontend heatmap overlay.
// Query params: hour (0–23)
// ───────────────────────────────────────────────────────────────────────────────
router.get("/risk-map", async (req: Request, res: Response) => {
  try {
    const { hour } = req.query;

    const pythonResponse = await axios.get(
      `${SAFE_ROUTE_API_URL}/risk-map?hour=${hour || new Date().getHours()}`,
      { timeout: 8_000 }
    );

    res.status(200).json(pythonResponse.data);
  } catch (err: any) {
    if (axios.isAxiosError(err)) {
      if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
        res.status(503).json({ error: "Risk map service unavailable" });
        return;
      }
      if (err.response) {
        res.status(err.response.status).json(err.response.data);
        return;
      }
    }
    console.error("[SAFE-ROUTE] GET /risk-map error:", err);
    res.status(500).json({ error: "Risk map fetch failed" });
  }
});

export default router;
