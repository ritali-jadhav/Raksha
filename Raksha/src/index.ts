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
app.use(express.text({ type: "text/plain" }));
app.use(express.urlencoded({ extended: true }));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  console.log("[HEALTH] GET /health - OK");
  res.status(200).send("OK");
});

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer(app);

// ─── PORT FIX (FINAL) ─────────────────────────────────────────────────────────
// 🔥 CRITICAL: log env + force correct binding
console.log("ENV PORT VALUE:", process.env.PORT);

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

// Fallback only for local dev — Railway will always provide PORT
if (!PORT) {
  console.warn("PORT undefined, falling back to 8080");
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[RAKSHA] Server running on port ${PORT} (HTTP + WebSocket)`);
  console.log(`[RAKSHA] Health: http://0.0.0.0:${PORT}/health`);

  loadApp().catch((err) => {
    console.error("[RAKSHA] App initialisation error (server still running):", err);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// loadApp — loads all routes and background services
// ─────────────────────────────────────────────────────────────────────────────
async function loadApp(): Promise<void> {
  try {
    const { initSocketIO } = await import("./services/socketManager");
    initSocketIO(server);
    console.log("[RAKSHA] Socket.IO ready");
  } catch (err) {
    console.error("[RAKSHA] Socket.IO init failed:", err);
  }

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