import cloudinary from "../config/cloudinary";
import { firestore } from "../config/firebase";

const MAX_UPLOAD_RETRIES = 2;

/**
 * Upload a media buffer to Cloudinary with retry logic.
 * Returns the secure URL and metadata.
 */
export async function uploadMediaToCloudinary(
  buffer: Buffer,
  incidentId: string,
  type: "image" | "video" | "audio" = "image",
  attempt = 0
): Promise<{
  url: string;
  publicId: string;
  format: string;
  resourceType: string;
} | null> {
  try {
    const result = await new Promise<any>((resolve, reject) => {
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
      stream.end(buffer);
    });

    console.log(`[MEDIA] Uploaded to Cloudinary: ${result.secure_url}`);
    return {
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      resourceType: result.resource_type,
    };
  } catch (err: any) {
    console.error(`[MEDIA] Upload failed (attempt ${attempt + 1}):`, err.message);
    if (attempt < MAX_UPLOAD_RETRIES) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      return uploadMediaToCloudinary(buffer, incidentId, type, attempt + 1);
    }
    return null;
  }
}

/**
 * Store evidence metadata in Firestore and optionally attach mediaUrl to the incident.
 */
export async function storeEvidence(
  userId: string,
  incidentId: string,
  type: "image" | "video" | "audio",
  url: string,
  publicId: string,
  format: string
): Promise<string> {
  const docRef = await firestore.collection("evidence").add({
    userId,
    incidentId,
    type,
    url,
    publicId,
    format,
    createdAt: new Date().toISOString(),
  });

  // Also attach the media URL to the incident document
  await firestore
    .collection("incidents")
    .doc(incidentId)
    .update({
      mediaUrl: url,
      mediaType: type,
      mediaUpdatedAt: new Date().toISOString(),
    })
    .catch((err) => {
      console.error("[MEDIA] Failed to attach media to incident:", err);
    });

  console.log(`[MEDIA] Evidence stored: ${docRef.id}`);
  return docRef.id;
}

/**
 * Upload media buffer and store in both Cloudinary and Firestore in one call.
 */
export async function uploadAndStoreEvidence(
  userId: string,
  incidentId: string,
  buffer: Buffer,
  type: "image" | "video" | "audio" = "image"
): Promise<string | null> {
  const uploaded = await uploadMediaToCloudinary(buffer, incidentId, type);
  if (!uploaded) {
    console.error("[MEDIA] Upload failed after retries");
    return null;
  }

  await storeEvidence(userId, incidentId, type, uploaded.url, uploaded.publicId, uploaded.format);
  return uploaded.url;
}
