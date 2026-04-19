import * as admin from "firebase-admin";

let firebaseInitialized = false;

function parsePrivateKey(raw: string | undefined): string {
  if (!raw) return "";
  // Handle both literal \n (from .env files) and actual newlines (from Render/Railway)
  return raw.replace(/\\n/g, "\n").replace(/\n/g, "\n").trim();
}

try {
  if (!admin.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = parsePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        `Missing Firebase env vars: ${[
          !projectId && "FIREBASE_PROJECT_ID",
          !clientEmail && "FIREBASE_CLIENT_EMAIL",
          !privateKey && "FIREBASE_PRIVATE_KEY",
        ].filter(Boolean).join(", ")}`
      );
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
      storageBucket: `${projectId}.appspot.com`,
    });

    firebaseInitialized = true;
    console.log("[FIREBASE] Initialized successfully");
  }
} catch (err) {
  console.error("[FIREBASE] Initialization failed:", err);
  // Do NOT re-throw — server must stay up even if Firebase fails
}

// Export safe wrappers that throw a clear error if Firebase failed to init
export const firestore = firebaseInitialized
  ? admin.firestore()
  : (() => { throw new Error("Firebase not initialized"); })();

export const realtimeDb = firebaseInitialized
  ? admin.database()
  : (() => { throw new Error("Firebase not initialized"); })();

export const storage = firebaseInitialized
  ? admin.storage().bucket()
  : (() => { throw new Error("Firebase not initialized"); })();

export default admin;
