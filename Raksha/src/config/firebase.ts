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
      databaseURL: `https://${projectId}-default-rtdb.asia-southeast1.firebasedatabase.app`,
      storageBucket: `${projectId}.appspot.com`,
    });

    firebaseInitialized = true;
    console.log("[FIREBASE] Initialized successfully");
  }
} catch (err) {
  console.error("[FIREBASE] Initialization failed:", err);
  // Do NOT re-throw — server must stay up even if Firebase fails
}

// ─── Lazy accessors ────────────────────────────────────────────────────────────
// Previous code used IIFEs that threw at import-time, crashing the server before
// the health-check port was even opened. These getters defer the error to actual
// usage, so /health stays alive and Railway deploys succeed even when Firebase
// credentials are temporarily unavailable.
// ─────────────────────────────────────────────────────────────────────────────

let _firestore: admin.firestore.Firestore | null = null;
let _realtimeDb: admin.database.Database | null = null;
let _storage: ReturnType<typeof admin.storage>["bucket"] extends (...args: any) => infer R ? R : never;

function getFirestore(): admin.firestore.Firestore {
  if (!firebaseInitialized) throw new Error("Firebase not initialized");
  if (!_firestore) _firestore = admin.firestore();
  return _firestore;
}

function getRealtimeDb(): admin.database.Database {
  if (!firebaseInitialized) throw new Error("Firebase not initialized");
  if (!_realtimeDb) _realtimeDb = admin.database();
  return _realtimeDb;
}

function getStorage() {
  if (!firebaseInitialized) throw new Error("Firebase not initialized");
  if (!_storage) _storage = admin.storage().bucket();
  return _storage;
}

// Proxy objects that forward all property access to the lazily-initialized real
// instances. This preserves the existing `firestore.collection(...)` call-sites
// without any refactoring while keeping the server alive on init failure.
export const firestore: admin.firestore.Firestore = new Proxy({} as admin.firestore.Firestore, {
  get(_target, prop, receiver) {
    return Reflect.get(getFirestore(), prop, receiver);
  },
});

export const realtimeDb: admin.database.Database = new Proxy({} as admin.database.Database, {
  get(_target, prop, receiver) {
    return Reflect.get(getRealtimeDb(), prop, receiver);
  },
});

export const storage = new Proxy({} as any, {
  get(_target, prop, receiver) {
    return Reflect.get(getStorage(), prop, receiver);
  },
});

export default admin;
