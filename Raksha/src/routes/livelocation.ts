import { Router } from "express";
import { firestore } from "../config/firebase";
import { requireAuth, getAuthUser } from "../middleware/auth";

const router = Router();

// Live location routes require authentication
router.use(requireAuth);

/**
 * Get live location of a user.
 * Only accessible if the requester is a confirmed guardian of that user,
 * or if the requester is the user themselves.
 */
router.get("/:userId", async (req, res) => {
  try {
    const requesterId = getAuthUser(req).userId;
    const { userId } = req.params;

    // Allow self-access
    if (requesterId !== userId) {
      // Check if the requester is a confirmed guardian of the target user
      const guardianCheck = await firestore
        .collection("guardian_links")
        .where("guardianId", "==", requesterId)
        .where("protectedId", "==", userId)
        .where("status", "==", "confirmed")
        .limit(1)
        .get();

      if (guardianCheck.empty) {
        return res
          .status(403)
          .json({ error: "Not authorized to view this user's location" });
      }
    }

    const doc = await firestore
      .collection("live_locations")
      .doc(userId)
      .get();

    if (!doc.exists) {
      return res.status(404).json({ error: "No live location found" });
    }

    return res.json({ success: true, location: doc.data() });
  } catch (error) {
    console.error("Live location fetch error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;