import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import path from "path";

let safeRouteProc: ChildProcessWithoutNullStreams | null = null;
let shutdownHooksRegistered = false;

function resolveSafeRouteBackendDir(): string | null {
  const fromEnv = process.env.SAFE_ROUTE_BACKEND_DIR;
  if (fromEnv) {
    const abs = path.resolve(fromEnv);
    if (fs.existsSync(path.join(abs, "app.py"))) return abs;
  }

  const candidates = [
    path.resolve(process.cwd(), "..", "Safe_route_updated-criminal-profiles", "safe_route", "backend"),
    path.resolve(process.cwd(), "Safe_route_updated-criminal-profiles", "safe_route", "backend"),
    path.resolve(process.cwd(), "..", "Raksha", "Safe_route_updated-criminal-profiles", "safe_route", "backend"),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "app.py"))) {
      return dir;
    }
  }

  return null;
}

function shouldAutostart(): boolean {
  if (String(process.env.SAFE_ROUTE_AUTOSTART || "").toLowerCase() === "false") {
    return false;
  }

  // If API URL points away from localhost, assume external service is used.
  const apiUrl = process.env.SAFE_ROUTE_API_URL || "http://localhost:5000";
  const isLocal =
    apiUrl.includes("localhost") ||
    apiUrl.includes("127.0.0.1") ||
    apiUrl.includes("0.0.0.0");

  return isLocal;
}

function registerShutdownHooks(): void {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;

  const stop = () => {
    if (!safeRouteProc) return;
    try {
      safeRouteProc.kill();
    } catch {}
    safeRouteProc = null;
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("exit", stop);
}

export function startSafeRouteProcess(): void {
  if (!shouldAutostart()) {
    console.log("[SAFE-ROUTE] Autostart skipped (SAFE_ROUTE_AUTOSTART=false or external SAFE_ROUTE_API_URL)");
    return;
  }

  if (safeRouteProc) {
    return;
  }

  const backendDir = resolveSafeRouteBackendDir();
  if (!backendDir) {
    console.warn("[SAFE-ROUTE] Backend directory not found. Set SAFE_ROUTE_BACKEND_DIR to enable autostart.");
    return;
  }

  const pythonCmd = process.env.SAFE_ROUTE_PYTHON_CMD || "python";
  const port = process.env.SAFE_ROUTE_PORT || "5000";
  const args = ["-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", port];

  try {
    safeRouteProc = spawn(pythonCmd, args, {
      cwd: backendDir,
      shell: process.platform === "win32",
      stdio: "pipe",
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
    });

    registerShutdownHooks();

    safeRouteProc.stdout.on("data", (chunk) => {
      const line = chunk.toString().trim();
      if (line) console.log(`[SAFE-ROUTE][PY] ${line}`);
    });

    safeRouteProc.stderr.on("data", (chunk) => {
      const line = chunk.toString().trim();
      if (line) console.error(`[SAFE-ROUTE][PY] ${line}`);
    });

    safeRouteProc.on("close", (code) => {
      console.warn(`[SAFE-ROUTE] Python process exited with code ${code}`);
      safeRouteProc = null;
    });

    console.log(`[SAFE-ROUTE] Python service autostarted from ${backendDir}`);
  } catch (err) {
    console.error("[SAFE-ROUTE] Failed to start Python service:", err);
  }
}

