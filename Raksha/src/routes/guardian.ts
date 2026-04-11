import { Router } from "express";
import { firestore } from "../config/firebase";
import { requireAuth, getAuthUser } from "../middleware/auth";
import {
  getGuardianDashboard,
  getGuardianNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  addExternalGuardian,
  getExternalGuardiansForUser,
  removeExternalGuardian,
} from "../services/guardianService";

const router = Router();

// All guardian routes require authentication
router.use(requireAuth);

/**
 * POST /guardian/invite
 * Invite a guardian by their userId. The authenticated user is the protected person.
 * Body: { guardianId }
 */
router.post("/invite", async (req, res) => {
  try {
    const { userId: protectedId } = getAuthUser(req);
    const { guardianId } = req.body;

    if (!guardianId) {
      return res.status(400).json({ error: "guardianId required" });
    }

    if (guardianId === protectedId) {
      return res.status(400).json({ error: "Cannot add yourself as guardian" });
    }

    // Verify guardian user exists
    const guardianDoc = await firestore.collection("users").doc(guardianId).get();
    if (!guardianDoc.exists) {
      return res.status(404).json({ error: "Guardian user not found" });
    }

    // Check duplicate
    const existing = await firestore
      .collection("guardian_links")
      .where("guardianId", "==", guardianId)
      .where("protectedId", "==", protectedId)
      .get();

    if (!existing.empty) {
      return res.json({ success: false, message: "Link already exists" });
    }

    const doc = await firestore.collection("guardian_links").add({
      guardianId,
      protectedId,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    return res.json({ success: true, linkId: doc.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /guardian/confirm
 * Accept a guardian request. Only the invited guardian can confirm.
 * Body: { linkId }
 */
router.post("/confirm", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);
    const { linkId } = req.body;

    if (!linkId) {
      return res.status(400).json({ error: "linkId required" });
    }

    const linkRef = firestore.collection("guardian_links").doc(linkId);
    const linkDoc = await linkRef.get();

    if (!linkDoc.exists) {
      return res.status(404).json({ error: "Guardian link not found" });
    }

    const linkData = linkDoc.data()!;

    // Only the invited guardian can confirm
    if (linkData.guardianId !== userId) {
      return res.status(403).json({ error: "Only the invited guardian can confirm" });
    }

    await linkRef.update({
      status: "confirmed",
      confirmedAt: new Date().toISOString(),
    });

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /guardian/reject
 * Reject a guardian request.
 * Body: { linkId }
 */
router.post("/reject", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);
    const { linkId } = req.body;

    if (!linkId) {
      return res.status(400).json({ error: "linkId required" });
    }

    const linkRef = firestore.collection("guardian_links").doc(linkId);
    const linkDoc = await linkRef.get();

    if (!linkDoc.exists) {
      return res.status(404).json({ error: "Guardian link not found" });
    }

    const linkData = linkDoc.data()!;

    // Either the guardian or the protected user can reject
    if (linkData.guardianId !== userId && linkData.protectedId !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    await linkRef.update({
      status: "rejected",
      rejectedAt: new Date().toISOString(),
    });

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /guardian/my-guardians
 * Get confirmed guardians for the authenticated user (as protected person)
 */
router.get("/my-guardians", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);

    const links = await firestore
      .collection("guardian_links")
      .where("protectedId", "==", userId)
      .where("status", "==", "confirmed")
      .get();

    const guardians: any[] = [];

    for (const doc of links.docs) {
      const data = doc.data();
      // Fetch guardian user info
      const guardianDoc = await firestore.collection("users").doc(data.guardianId).get();
      const guardianData = guardianDoc.exists ? guardianDoc.data() : null;

      guardians.push({
        linkId: doc.id,
        guardianId: data.guardianId,
        name: guardianData?.name || "Unknown",
        email: guardianData?.email || null,
        phone: guardianData?.phone || null,
      });
    }

    res.json({ success: true, guardians });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch guardians" });
  }
});

/**
 * GET /guardian/my-protected
 * Get users the authenticated user is guarding
 */
router.get("/my-protected", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);

    const links = await firestore
      .collection("guardian_links")
      .where("guardianId", "==", userId)
      .where("status", "==", "confirmed")
      .get();

    const protectedUsers: any[] = [];

    for (const doc of links.docs) {
      const data = doc.data();
      const protectedDoc = await firestore.collection("users").doc(data.protectedId).get();
      const protectedData = protectedDoc.exists ? protectedDoc.data() : null;

      protectedUsers.push({
        linkId: doc.id,
        protectedId: data.protectedId,
        name: protectedData?.name || "Unknown",
        email: protectedData?.email || null,
        phone: protectedData?.phone || null,
      });
    }

    res.json({ success: true, protectedUsers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch protected users" });
  }
});

/**
 * GET /guardian/pending
 * Get pending guardian requests for the authenticated user
 */
router.get("/pending", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);

    // Requests where I'm invited as guardian
    const asGuardian = await firestore
      .collection("guardian_links")
      .where("guardianId", "==", userId)
      .where("status", "==", "pending")
      .get();

    // Requests where I invited someone
    const asProtected = await firestore
      .collection("guardian_links")
      .where("protectedId", "==", userId)
      .where("status", "==", "pending")
      .get();

    const incoming = asGuardian.docs.map((doc) => ({
      linkId: doc.id,
      type: "incoming",
      ...doc.data(),
    }));

    const outgoing = asProtected.docs.map((doc) => ({
      linkId: doc.id,
      type: "outgoing",
      ...doc.data(),
    }));

    res.json({ success: true, incoming, outgoing });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch pending requests" });
  }
});

/**
 * DELETE /guardian/:linkId
 * Remove a guardian link
 */
router.delete("/:linkId", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);
    const { linkId } = req.params;

    const linkRef = firestore.collection("guardian_links").doc(linkId);
    const linkDoc = await linkRef.get();

    if (!linkDoc.exists) {
      return res.status(404).json({ error: "Guardian link not found" });
    }

    const linkData = linkDoc.data()!;

    // Either party can remove the link
    if (linkData.guardianId !== userId && linkData.protectedId !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    await linkRef.delete();

    return res.json({ success: true, message: "Guardian link removed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /guardian/invite-by-email
 * Invite a guardian using their email address (more user-friendly).
 * Body: { email }
 */
router.post("/invite-by-email", async (req, res) => {
  try {
    const { userId: protectedId } = getAuthUser(req);
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }

    // Find user by email
    const userSnapshot = await firestore
      .collection("users")
      .where("email", "==", email.toLowerCase().trim())
      .limit(1)
      .get();

    if (userSnapshot.empty) {
      return res.status(404).json({ error: "No user found with that email" });
    }

    const guardianDoc = userSnapshot.docs[0];
    const guardianId = guardianDoc.id;

    if (guardianId === protectedId) {
      return res.status(400).json({ error: "Cannot add yourself as guardian" });
    }

    // Check duplicate
    const existing = await firestore
      .collection("guardian_links")
      .where("guardianId", "==", guardianId)
      .where("protectedId", "==", protectedId)
      .get();

    if (!existing.empty) {
      const existingData = existing.docs[0].data();
      return res.json({
        success: false,
        message: `Link already exists (status: ${existingData.status})`,
      });
    }

    const doc = await firestore.collection("guardian_links").add({
      guardianId,
      protectedId,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    return res.json({
      success: true,
      linkId: doc.id,
      guardianName: guardianDoc.data()?.name || "Unknown",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /guardian/dashboard
 * Guardian dashboard — shows all protected users with their status,
 * live location, and active incidents.
 */
router.get("/dashboard", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);

    const dashboard = await getGuardianDashboard(userId);

    res.json({ success: true, dashboard });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

/**
 * GET /guardian/notifications
 * Get all notifications for the authenticated guardian
 */
router.get("/notifications", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);

    const notifications = await getGuardianNotifications(userId);

    res.json({ success: true, notifications });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

/**
 * POST /guardian/notifications/:id/read
 * Mark a single notification as read
 */
router.post("/notifications/:id/read", async (req, res) => {
  try {
    const { id } = req.params;

    await markNotificationRead(id);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to mark notification" });
  }
});

/**
 * POST /guardian/notifications/read-all
 * Mark all notifications as read
 */
router.post("/notifications/read-all", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);

    const result = await markAllNotificationsRead(userId);

    res.json({ success: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to mark notifications" });
  }
});

// ====================================================================
//  EXTERNAL PHONE-ONLY GUARDIAN ROUTES
// ====================================================================

/**
 * POST /guardian/add-phone
 * Add an external phone-only guardian (not an app user).
 * Body: { name, phone }
 */
router.post("/add-phone", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);
    const { name, phone } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: "Name and phone number required" });
    }

    const result = await addExternalGuardian(userId, name, phone);
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to add guardian phone" });
  }
});

/**
 * GET /guardian/phone-guardians
 * List all external phone-only guardians for the authenticated user
 */
router.get("/phone-guardians", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);

    const guardians = await getExternalGuardiansForUser(userId);
    res.json({ success: true, guardians });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch phone guardians" });
  }
});

/**
 * DELETE /guardian/phone/:id
 * Remove an external phone guardian
 */
router.delete("/phone/:id", async (req, res) => {
  try {
    const { userId } = getAuthUser(req);
    const { id } = req.params;

    const result = await removeExternalGuardian(userId, id);
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to remove guardian phone" });
  }
});

export default router;

