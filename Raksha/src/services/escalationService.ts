import { firestore } from "../config/firebase";

const ESCALATION_INTERVALS_MS = [
  { stage: 1, delay: 60000 },
  { stage: 2, delay: 120000 },
  { stage: 3, delay: 180000 },
  { stage: 4, delay: 240000 },
];

const activeEscalations: Map<string, NodeJS.Timeout[]> = new Map();

/**
 * 🔒 Idempotent escalation to a specific stage
 */
const escalateToStage = async (
  incidentId: string,
  stage: number
): Promise<void> => {
  try {
    const incidentRef = firestore.collection("incidents").doc(incidentId);
    const incidentDoc = await incidentRef.get();

    if (!incidentDoc.exists) {
      console.warn(`[ESCALATION] Incident not found, skipping stage ${stage}: ${incidentId}`);
      return;
    }

    const incidentData = incidentDoc.data();

    if (!incidentData) return;

    if (incidentData.status !== "active") {
      console.log(
        `[ESCALATION] Incident not active (${incidentData.status}), skipping stage ${stage}: ${incidentId}`
      );
      stopEscalation(incidentId);
      return;
    }

    if ((incidentData.escalationStage ?? 0) >= stage) {
      console.log(
        `[ESCALATION] Already at stage ${incidentData.escalationStage}, skipping stage ${stage}: ${incidentId}`
      );
      return;
    }

    const now = new Date().toISOString();

    const updatePayload: Record<string, unknown> = {
      escalationStage: stage,
      escalationUpdatedAt: now,
    };

    if (!incidentData.escalationStartedAt) {
      updatePayload.escalationStartedAt = now;
    }

    await incidentRef.update(updatePayload);

    await incidentRef.collection("escalationEvents").add({
      stage,
      escalatedAt: now,
      previousStage: incidentData.escalationStage ?? 0,
    });

    console.log(`[ESCALATION] Incident ${incidentId} escalated to stage ${stage}`);

    // If final stage reached → stop tracking
    if (stage === 4) {
      stopEscalation(incidentId);
    }
  } catch (err) {
    console.error(
      `[ESCALATION] Error escalating incident ${incidentId} to stage ${stage}:`,
      err
    );
  }
};

/**
 * 🚀 Start escalation timeline
 */
export const startEscalation = (incidentId: string): void => {
  if (activeEscalations.has(incidentId)) {
    console.warn(`[ESCALATION] Already running: ${incidentId}`);
    return;
  }

  const timeouts: NodeJS.Timeout[] = [];

  for (const { stage, delay } of ESCALATION_INTERVALS_MS) {
    const timeout = setTimeout(async () => {
      await escalateToStage(incidentId, stage);
    }, delay);

    timeouts.push(timeout);
  }

  activeEscalations.set(incidentId, timeouts);

  console.log(`[ESCALATION] Timeline started: ${incidentId}`);
};

/**
 * 🛑 Stop escalation
 */
export const stopEscalation = (incidentId: string): void => {
  const timeouts = activeEscalations.get(incidentId);

  if (!timeouts) return;

  for (const timeout of timeouts) {
    clearTimeout(timeout);
  }

  activeEscalations.delete(incidentId);

  console.log(`[ESCALATION] Timeline stopped: ${incidentId}`);
};

/**
 * 📋 Check if active
 */
export const isEscalationActive = (incidentId: string): boolean => {
  return activeEscalations.has(incidentId);
};

/**
 * ♻️ Recover escalation after server restart
 * Re-start timelines for all active incidents
 */
export const resumeActiveEscalations = async (): Promise<void> => {
  try {
    const snapshot = await firestore
      .collection("incidents")
      .where("status", "==", "active")
      .get();

    snapshot.forEach((doc) => {
      const data = doc.data();

      if (!data) return;

      const currentStage = data.escalationStage ?? 0;

      // Only restart if not fully escalated
      if (currentStage < 4) {
        startEscalation(doc.id);
      }
    });

    console.log("[ESCALATION] Recovery complete");
  } catch (err) {
    console.error("[ESCALATION] Failed to resume escalations:", err);
  }
};