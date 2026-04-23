import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { firestore } from "../config/firebase";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || "raksha-secret-key-change-in-production";
const JWT_EXPIRES_IN = "7d";

/**
 * 🔐 Signup
 * Body: { email, password, name, phone?, safetyPin? }
 */
router.post("/signup", async (req, res) => {
  try {
    const { email, password, name, phone, safetyPin } = req.body;

    if (!email || !password || !name) {
      return res
        .status(400)
        .json({ error: "Missing required fields: email, password, name" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }

    // Check if email already exists
    const existingUser = await firestore
      .collection("users")
      .where("email", "==", email.toLowerCase().trim())
      .limit(1)
      .get();

    if (!existingUser.empty) {
      return res.status(409).json({ error: "Email already registered" });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user document
    const userRef = firestore.collection("users").doc();
    const userId = userRef.id;

    // Hash safety PIN
    const rawPin = safetyPin || "1234";
    const hashedPin = await bcrypt.hash(rawPin, 10);

    const userData = {
      userId,
      email: email.toLowerCase().trim(),
      name: name.trim(),
      phone: phone?.trim() || null,
      password: hashedPassword,
      safetyPin: hashedPin,
      createdAt: new Date().toISOString(),
    };

    await userRef.set(userData);

    // Generate JWT
    const token = jwt.sign(
      { userId, email: userData.email, name: userData.name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.status(201).json({
      success: true,
      token,
      user: {
        userId,
        email: userData.email,
        name: userData.name,
        phone: userData.phone,
      },
    });
  } catch (error) {
    console.error("[AUTH] Signup error:", error);
    return res.status(500).json({ error: "Signup failed" });
  }
});

/**
 * 🔐 Login
 * Body: { email, password }
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }

    // Find user by email
    const snapshot = await firestore
      .collection("users")
      .where("email", "==", email.toLowerCase().trim())
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();

    // Verify password
    const isMatch = await bcrypt.compare(password, userData.password);

    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Generate JWT
    const token = jwt.sign(
      {
        userId: userDoc.id,
        email: userData.email,
        name: userData.name,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.json({
      success: true,
      token,
      user: {
        userId: userDoc.id,
        email: userData.email,
        name: userData.name,
        phone: userData.phone,
      },
    });
  } catch (error) {
    console.error("[AUTH] Login error:", error);
    return res.status(500).json({ error: "Login failed" });
  }
});

/**
 * 👤 Get current user profile (requires auth)
 * Uses a 60-second in-memory cache to reduce Firestore reads.
 */
const profileCache = new Map<string, { data: any; expiresAt: number }>();
const PROFILE_CACHE_TTL_MS = 60_000; // 60 seconds

router.get("/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const token = authHeader.split(" ")[1];

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const userId = decoded.userId;

    // Check cache first
    const cached = profileCache.get(userId);
    if (cached && Date.now() < cached.expiresAt) {
      return res.json(cached.data);
    }

    const userDoc = await firestore
      .collection("users")
      .doc(userId)
      .get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userDoc.data()!;

    const responseData = {
      success: true,
      user: {
        userId: userDoc.id,
        email: userData.email,
        name: userData.name,
        phone: userData.phone,
        hasSafetyPin: !!userData.safetyPin,
        createdAt: userData.createdAt,
      },
    };

    // Store in cache
    profileCache.set(userId, {
      data: responseData,
      expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
    });

    return res.json(responseData);
  } catch (error) {
    console.error("[AUTH] Profile error:", error);
    return res.status(500).json({ error: "Failed to fetch profile" });
  }
});

/**
 * 🔑 Update safety PIN (requires auth)
 */
router.put("/safety-pin", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const token = authHeader.split(" ")[1];

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const { newPin } = req.body;

    if (!newPin || newPin.length < 4) {
      return res
        .status(400)
        .json({ error: "PIN must be at least 4 characters" });
    }

    // Hash the new PIN before storing
    const hashedPin = await bcrypt.hash(newPin, 10);

    await firestore.collection("users").doc(decoded.userId).update({
      safetyPin: hashedPin,
    });

    return res.json({ success: true, message: "Safety PIN updated" });
  } catch (error) {
    console.error("[AUTH] PIN update error:", error);
    return res.status(500).json({ error: "Failed to update PIN" });
  }
});

export default router;
