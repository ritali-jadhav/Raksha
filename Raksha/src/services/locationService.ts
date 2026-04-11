import { firestore, realtimeDb } from "../config/firebase";
import { emitLocationUpdate } from "./socketManager";

/**
 * 📍 Updates live location in Realtime DB + stores last known in Firestore
 *
 * Uses set() with merge to prevent crashes when user doc doesn't exist yet.
 * Also emits real-time location to guardians via WebSocket.
 */
export async function updateLocation(
  userId: string,
  lat: number,
  lng: number
) {
  const now = new Date();

  // Update live location (Realtime DB — for real-time listeners)
  await realtimeDb.ref(`live_locations/${userId}`).set({
    lat,
    lng,
    updatedAt: now.getTime(),
  });

  // Store in Firestore live_locations collection (for REST API queries)
  await firestore.collection("live_locations").doc(userId).set(
    {
      lat,
      lng,
      updatedAt: now.toISOString(),
    },
    { merge: true }
  );

  // Store last known location on user profile (merge to avoid overwriting other fields)
  await firestore.collection("users").doc(userId).set(
    {
      lastLocation: {
        lat,
        lng,
        updatedAt: now.toISOString(),
      },
    },
    { merge: true }
  );

  // Emit real-time location to guardians via WebSocket
  emitLocationUpdate(userId, lat, lng);

  return { success: true, message: "Location updated" };
}
