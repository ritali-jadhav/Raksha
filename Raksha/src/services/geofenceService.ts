import { firestore } from "../config/firebase";
import { haversineDistance } from "../utils/distance";

/**
 * 📍 Check Geofence Breach
 * Returns whether user is outside any of their defined safe zones.
 * Field names match the geofence creation route: protectedId, centerLat, centerLng, radiusMeters
 */
export const checkGeofenceBreach = async (
  userId: string,
  lat: number,
  lng: number
): Promise<{ breached: boolean; breachedZones: string[] }> => {
  try {
    const snapshot = await firestore
      .collection("geofences")
      .where("protectedId", "==", userId)
      .get();

    if (snapshot.empty) {
      return { breached: false, breachedZones: [] };
    }

    const breachedZones: string[] = [];
    let insideAny = false;

    for (const doc of snapshot.docs) {
      const data = doc.data();

      if (
        data.centerLat == null ||
        data.centerLng == null ||
        data.radiusMeters == null
      ) {
        continue;
      }

      const distance = haversineDistance(
        lat,
        lng,
        data.centerLat,
        data.centerLng
      );

      if (distance <= data.radiusMeters) {
        insideAny = true;
      } else {
        breachedZones.push(data.name || doc.id);
      }
    }

    // Only considered a breach if the user is outside ALL zones
    // (i.e., not inside any safe zone)
    if (!insideAny && breachedZones.length > 0) {
      // Log breach event
      await firestore.collection("geofence_breaches").add({
        userId,
        breachedZones,
        lat,
        lng,
        createdAt: new Date().toISOString(),
      });
    }

    return {
      breached: !insideAny && breachedZones.length > 0,
      breachedZones,
    };
  } catch (error) {
    console.error("[GEOFENCE] Error checking breach:", error);
    return { breached: false, breachedZones: [] };
  }
};