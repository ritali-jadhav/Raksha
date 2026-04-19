import express from "express";
import cors from "cors";
import http from "http";
import "dotenv/config";

// ─── Express App ──────────────────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());
// Also parse text/plain bodies (sendBeacon / older WebViews)
app.use(express.text({ type: "text/plain" }));
app.use(express.urlencoded({ extended: true }));

// ─── Health Check ─────────────────────────────────────────────────────────────
// Registered BEFORE all other routes and BEFORE any external service init.
// Railway pings this during deploy — it must always return 200 immediately.
app.get("/health", (_req, res) => {
  console.log("[HEALTH] GET /health - OK");
  res.status(200).send("OK");
});
// ─────────────────────────────────────────────────────────────────────────────

// ─── HTTP Server ──────────────────────────────────────────────────────────────
// Create the server immediately — before loading any routes or external services.
// This guarantees Railway can probe /health the instant the port opens.
const server = http.createServer(app);

// ─── Port & Binding ───────────────────────────────────────────────────────────
// Railway provides PORT via environment variable. Bind to 0.0.0.0 (not localhost)
// so the container port is externally reachable.
const PORT = Number(process.env.PORT);

if (!PORT) {
  throw new Error("PORT not defined");
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[RAKSHA] Server running on port ${PORT} (HTTP + WebSocket)`);
  console.log(`[RAKSHA] Health: http://0.0.0.0:${PORT}/health`);

  // ── Load routes & services AFTER port is bound ────────────────────────────
  // Any failure here will log an error but will NOT kill the server.
  // /health remains available so Railway does not restart the container.
  loadApp().catch((err) => {
    console.error("[RAKSHA] App initialisation error (server still running):", err);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// loadApp — loads all routes and background services after server is listening.
// Wrapped entirely in try/catch so a Firebase or Twilio failure never crashes
// the server process.
// ─────────────────────────────────────────────────────────────────────────────
async function loadApp(): Promise<void> {
  // ── Socket.IO ──────────────────────────────────────────────────────────────
  try {
    const { initSocketIO } = await import("./services/socketManager");
    initSocketIO(server);
    console.log("[RAKSHA] Socket.IO ready");
  } catch (err) {
    console.error("[RAKSHA] Socket.IO init failed:", err);
  }

  // ── API Routes ─────────────────────────────────────────────────────────────
  // Each router is loaded individually so one broken import doesn't block others.
  const routes: Array<{ path: string; mod: string }> = [
    { path: "/auth",          mod: "./routes/auth"        },
    { path: "/sos",           mod: "./routes/sos"         },
    { path: "/guardian",      mod: "./routes/guardian"    },
    { path: "/geofence",      mod: "./routes/geofence"    },
    { path: "/location",      mod: "./routes/location"    },
    { path: "/evidence",      mod: "./routes/evidence"    },
    { path: "/live-location", mod: "./routes/livelocation"},
    { path: "/push",          mod: "./routes/push"        },
    { path: "/checkin",       mod: "./routes/checkin"     },
    { path: "/journey",       mod: "./routes/journey"     },
    { path: "/community",     mod: "./routes/incidents"   },
    { path: "/analytics",     mod: "./routes/analytics"   },
  ];

  for (const { path, mod } of routes) {
    try {
      const router = await import(mod);
      app.use(path, router.default);
      console.log(`[RAKSHA] Route mounted: ${path}`);
    } catch (err) {
      console.error(`[RAKSHA] Failed to mount route ${path}:`, err);
    }
  }

  // ── Background Services ────────────────────────────────────────────────────
  try {
    const { startTamperMonitor } = await import("./services/tamperMonitor");
    startTamperMonitor();
    console.log("[RAKSHA] Tamper monitor started");
  } catch (err) {
    console.error("[RAKSHA] Tamper monitor failed to start:", err);
  }

  try {
    const { resumeActiveEscalations } = await import("./services/escalationService");
    await resumeActiveEscalations();
    console.log("[RAKSHA] Escalation recovery complete");
  } catch (err) {
    console.error("[RAKSHA] Escalation recovery failed:", err);
  }

  console.log("[RAKSHA] All services initialised");
}