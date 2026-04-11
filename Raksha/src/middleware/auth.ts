import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET || "raksha-secret-key-change-in-production";

/**
 * JWT payload attached to req.user after verification
 */
export interface AuthUser {
  userId: string;
  email: string;
  name: string;
}

/**
 * Helper to get authenticated user from request.
 * Must be used after requireAuth middleware has run.
 */
export function getAuthUser(req: Request): AuthUser {
  return (req as any).user as AuthUser;
}

/**
 * 🔒 JWT Authentication Middleware
 *
 * Verifies the Bearer token from the Authorization header.
 * On success, attaches decoded user info to `req.user`.
 * On failure, returns 401.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Missing token" });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;

    (req as any).user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
