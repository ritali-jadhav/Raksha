
import { Router } from "express";
import multer from "multer";
import cloudinary from "../config/cloudinary";
import { firestore } from "../config/firebase";
import { requireAuth, getAuthUser } from "../middleware/auth";
import { attachMediaToIncident } from "../services/sosService";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// All evidence routes require authentication
router.use(requireAuth);

/**
 * 📤 Upload evidence (audio/video/image) for an incident
 */
router.post("/upload", upload.single("file"), async (req: any, res: any) => {
  try {
    const { userId } = getAuthUser(req);
    const { incidentId, type } = req.body;

    if (!incidentId || !type || !req.file) {
      return res.status(400).json({ error: "Missing incidentId, type, or file" });
    }

    // Upload buffer to Cloudinary
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `raksha/evidence/${incidentId}`,
          resource_type: "auto",
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );

      stream.end(req.file!.buffer);
    });

    const uploadResult = result as any;

    // Save metadata in Firestore
    await firestore.collection("evidence").add({
      userId,
      incidentId,
      type,
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      format: uploadResult.format,
      createdAt: new Date().toISOString(),
    });

    // Also update the incident record and trigger follow-up SMS
    attachMediaToIncident(incidentId, uploadResult.secure_url, type).catch((err) =>
      console.error("[EVIDENCE] Failed to attach media to incident:", err)
    );

    return res.json({
      success: true,
      url: uploadResult.secure_url,
    });

  } catch (error) {
    console.error("Upload error:", error);
    return res.status(500).json({ error: "Upload failed" });
  }
});

/**
 * 📋 Get all evidence for an incident
 */
router.get("/:incidentId", async (req, res) => {
  try {
    const { incidentId } = req.params;

    if (!incidentId) {
      return res.status(400).json({ error: "Missing incidentId" });
    }

    const snapshot = await firestore
      .collection("evidence")
      .where("incidentId", "==", incidentId)
      .get();

    const evidence = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Sort in-memory (newest first)
    evidence.sort((a: any, b: any) =>
      (b.createdAt || "").localeCompare(a.createdAt || "")
    );

    return res.json({ success: true, evidence });
  } catch (error) {
    console.error("[EVIDENCE] Fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch evidence" });
  }
});

export default router;