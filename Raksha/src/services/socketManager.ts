import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HTTPServer } from "http";
import jwt from "jsonwebtoken";
import { getGuardiansForUser } from "./guardianService";

let io: SocketIOServer | null = null;

// Map userId → Set of socket IDs for that user
const userSockets = new Map<string, Set<string>>();

/**
 * Initialize Socket.IO server
 */
export function initSocketIO(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // JWT authentication middleware
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Authentication required"));
    }

    try {
      const secret = process.env.JWT_SECRET || "raksha_secret";
      const decoded = jwt.verify(token, secret) as { userId: string };
      (socket as any).userId = decoded.userId;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", async (socket: Socket) => {
    const userId = (socket as any).userId;
    console.log(`[SOCKET] Connected: ${userId} (${socket.id})`);

    // Track socket
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId)!.add(socket.id);

    // Join user's own room
    socket.join(`user:${userId}`);

    // Join rooms for all users this person is guarding
    try {
      const { getProtectedUsersForGuardian } = await import("./guardianService");
      const protectedUsers = await getProtectedUsersForGuardian(userId);
      for (const link of protectedUsers) {
        const protId = (link as any).protectedId;
        socket.join(`guardians:${protId}`);
        console.log(`[SOCKET] ${userId} joined guardian room for ${protId}`);
      }
    } catch (err) {
      console.error("[SOCKET] Error joining guardian rooms:", err);
    }

    // Handle client-sent location updates (relay to guardians)
    socket.on("location:share", (data: { lat: number; lng: number }) => {
      io?.to(`guardians:${userId}`).emit("location:update", {
        userId,
        lat: data.lat,
        lng: data.lng,
        timestamp: new Date().toISOString(),
      });
    });

    // Handle guardian responding to SOS
    socket.on("sos:respond", (data: { incidentId: string; protectedUserId: string }) => {
      io?.to(`user:${data.protectedUserId}`).emit("sos:guardian-responded", {
        guardianId: userId,
        incidentId: data.incidentId,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("disconnect", () => {
      console.log(`[SOCKET] Disconnected: ${userId} (${socket.id})`);
      const sockets = userSockets.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          userSockets.delete(userId);
        }
      }
    });
  });

  console.log("[SOCKET] Socket.IO initialized");
  return io;
}

/**
 * Get the Socket.IO instance
 */
export function getIO(): SocketIOServer | null {
  return io;
}

/**
 * Emit an event to a specific user
 */
export function emitToUser(userId: string, event: string, data: any): void {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
}

/**
 * Emit an event to all guardians of a user
 */
export function emitToGuardians(userId: string, event: string, data: any): void {
  if (!io) return;
  io.to(`guardians:${userId}`).emit(event, {
    ...data,
    protectedUserId: userId,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Emit SOS triggered event to all guardians
 */
export function emitSOSTriggered(
  userId: string,
  incidentId: string,
  userName: string,
  triggerType: string,
  userPhone?: string | null
): void {
  emitToGuardians(userId, "sos:triggered", {
    incidentId,
    userName,
    triggerType,
    status: "active",
    userPhone: userPhone || null,
  });
}

/**
 * Emit SOS cancelled event
 */
export function emitSOSCancelled(userId: string, incidentId: string): void {
  emitToGuardians(userId, "sos:cancelled", { incidentId });
}

/**
 * Emit SOS resolved event
 */
export function emitSOSResolved(userId: string, incidentId: string): void {
  emitToGuardians(userId, "sos:resolved", { incidentId });
}

/**
 * Emit live location update to guardians
 */
export function emitLocationUpdate(
  userId: string,
  lat: number,
  lng: number
): void {
  emitToGuardians(userId, "location:update", { lat, lng });
}

/**
 * Emit escalation update
 */
export function emitEscalationUpdate(
  userId: string,
  incidentId: string,
  stage: number
): void {
  emitToGuardians(userId, "sos:escalation", { incidentId, stage });
  emitToUser(userId, "sos:escalation", { incidentId, stage });
}

/**
 * Emit media captured event to guardians.
 * Sent when Cloudinary upload completes and media URL is available.
 */
export function emitMediaCaptured(
  userId: string,
  incidentId: string,
  mediaUrl: string,
  mediaType: string
): void {
  emitToGuardians(userId, "sos:media-captured", {
    incidentId,
    mediaUrl,
    mediaType,
  });
  // Also emit to the user for confirmation
  emitToUser(userId, "sos:media-captured", {
    incidentId,
    mediaUrl,
    mediaType,
  });
}

/**
 * Emit a generic incident update to guardians
 */
export function emitIncidentUpdate(
  userId: string,
  incidentId: string,
  data: Record<string, unknown>
): void {
  emitToGuardians(userId, "sos:incident-update", { incidentId, ...data });
}


