import express from "express";
import cors from "cors";
import http from "http";
import "dotenv/config";

import { initSocketIO } from "./services/socketManager";
import { startTamperMonitor } from "./services/tamperMonitor";
import { resumeActiveEscalations } from "./services/escalationService";

import authRouter from "./routes/auth";
import sosRouter from "./routes/sos";
import guardianRouter from "./routes/guardian";
import geofenceRouter from "./routes/geofence";
import locationRouter from "./routes/location";
import evidenceRouter from "./routes/evidence";
import liveLocationRouter from "./routes/livelocation";
import pushRouter from "./routes/push";
import checkinRouter from "./routes/checkin";
import journeyRouter from "./routes/journey";
import communityRouter from "./routes/incidents";
import analyticsRouter from "./routes/analytics";

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());
// Also parse text/plain bodies (used by sendBeacon in older WebViews)
app.use(express.text({ type: 'text/plain' }));
app.use(express.urlencoded({ extended: true }));

// ─── Health Check ────────────────────────────────────────────────────────────
// Registered FIRST so Railway health checks always succeed, regardless of
// whether background services (Firebase, Twilio) have finished initialising.
app.get("/health", (_req, res) => {
  res.status(200).send("OK");
});
// ─────────────────────────────────────────────────────────────────────────────

// Create HTTP server (needed for Socket.IO)
const server = http.createServer(app);

// Initialize Socket.IO on the HTTP server
initSocketIO(server);

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use("/auth", authRouter);
app.use("/sos", sosRouter);
app.use("/guardian", guardianRouter);
app.use("/geofence", geofenceRouter);
app.use("/location", locationRouter);
app.use("/evidence", evidenceRouter);
app.use("/live-location", liveLocationRouter);
app.use("/push", pushRouter);
app.use("/checkin", checkinRouter);
app.use("/journey", journeyRouter);
app.use("/community", communityRouter);
app.use("/analytics", analyticsRouter);

// ─── Port & Server Start ─────────────────────────────────────────────────────
// Railway provides PORT via environment variable. Bind to 0.0.0.0 so the
// container's port is accessible externally.
const PORT: number = Number(process.env.PORT) || 4000;

// Start background services (non-blocking — do not await)
startTamperMonitor();
resumeActiveEscalations();

// server.listen instead of app.listen — required for Socket.IO
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[RAKSHA] Backend running on port ${PORT} (HTTP + WebSocket)`);
  console.log(`[RAKSHA] Health check: http://0.0.0.0:${PORT}/health`);
});