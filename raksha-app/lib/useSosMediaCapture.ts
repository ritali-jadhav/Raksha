/**
 * useSosMediaCapture
 *
 * Self-contained hook for automatic evidence capture on SOS trigger.
 *
 * Responsibilities:
 *  - Request camera + microphone permissions on mount
 *  - Expose captureAndUpload(incidentId, token) to call after SOS fires
 *  - Take a still photo immediately, then record a 5-second video clip
 *  - Upload each file to POST /sos/attach-media on the Node backend
 *  - Always fail silently — SOS is never blocked by capture errors
 */

import { useRef, useEffect, useCallback } from "react";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as FileSystem from "expo-file-system";
import { API_BASE } from "./api";

// How long (ms) to record a video clip after SOS
const VIDEO_DURATION_MS = 6000;

// ─── Types ────────────────────────────────────────────────────────────────────
interface CaptureStatus {
  permissionsGranted: boolean;
  capturing: boolean;
  imageUploaded: boolean;
  videoUploaded: boolean;
  error: string | null;
}

interface UseSosMediaCaptureReturn {
  cameraRef: React.RefObject<CameraView | null>;
  status: CaptureStatus;
  captureAndUpload: (incidentId: string, authToken: string) => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSosMediaCapture(
  onStatusChange?: (status: Partial<CaptureStatus>) => void
): UseSosMediaCaptureReturn {
  const cameraRef = useRef<CameraView | null>(null);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const statusRef = useRef<CaptureStatus>({
    permissionsGranted: false,
    capturing: false,
    imageUploaded: false,
    videoUploaded: false,
    error: null,
  });

  const updateStatus = (patch: Partial<CaptureStatus>) => {
    statusRef.current = { ...statusRef.current, ...patch };
    onStatusChange?.(patch);
  };

  // Request permissions on mount
  useEffect(() => {
    (async () => {
      try {
        const camResult = await requestCameraPermission();
        const micResult = await requestMicPermission();
        const granted = camResult.granted && micResult.granted;
        updateStatus({ permissionsGranted: granted });
        if (!granted) {
          console.warn("[SOS-CAPTURE] Camera or microphone permission not granted");
        }
      } catch (err) {
        console.warn("[SOS-CAPTURE] Permission request failed:", err);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Upload a file URI to POST /sos/attach-media on the Node backend.
   * Uses FormData + fetch with the auth token.
   */
  const uploadFile = async (
    fileUri: string,
    mimeType: string,
    type: "image" | "video",
    incidentId: string,
    authToken: string
  ): Promise<boolean> => {
    try {
      const formData = new FormData();
      formData.append("incidentId", incidentId);
      formData.append("type", type);
      formData.append("file", {
        uri: fileUri,
        name: type === "image" ? "evidence.jpg" : "evidence.mp4",
        type: mimeType,
      } as any);

      const response = await fetch(`${API_BASE}/sos/attach-media`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          // Do NOT set Content-Type manually — fetch sets multipart boundary automatically
        },
        body: formData,
      });

      if (!response.ok) {
        const body = await response.text();
        console.warn(`[SOS-CAPTURE] Upload failed (${response.status}): ${body}`);
        return false;
      }

      const data = await response.json();
      console.log(`[SOS-CAPTURE] ${type} uploaded:`, data.mediaUrl);
      return true;
    } catch (err) {
      console.error(`[SOS-CAPTURE] Network error uploading ${type}:`, err);
      return false;
    }
  };

  /**
   * Main function: capture image + video, then upload both.
   * Called immediately after triggerSOS() returns an incidentId.
   * Never throws — all errors are caught and logged.
   */
  const captureAndUpload = useCallback(
    async (incidentId: string, authToken: string): Promise<void> => {
      if (!statusRef.current.permissionsGranted) {
        console.warn("[SOS-CAPTURE] Skipping capture — permissions not granted");
        return;
      }

      const camera = cameraRef.current;
      if (!camera) {
        console.warn("[SOS-CAPTURE] Camera ref not available");
        return;
      }

      updateStatus({ capturing: true, imageUploaded: false, videoUploaded: false, error: null });

      // ── 1. Capture still image ───────────────────────────────────────────────
      try {
        const photo = await camera.takePictureAsync({
          quality: 0.7,
          skipProcessing: true,
        });

        if (photo?.uri) {
          console.log("[SOS-CAPTURE] Image captured:", photo.uri);
          const ok = await uploadFile(photo.uri, "image/jpeg", "image", incidentId, authToken);
          updateStatus({ imageUploaded: ok });

          // Clean up temp file
          FileSystem.deleteAsync(photo.uri, { idempotent: true }).catch(() => {});
        }
      } catch (err) {
        console.error("[SOS-CAPTURE] Image capture failed:", err);
        updateStatus({ error: "Image capture failed" });
      }

      // ── 2. Record short video clip ───────────────────────────────────────────
      try {
        // Start recording
        const videoPromise = camera.recordAsync({
          maxDuration: VIDEO_DURATION_MS / 1000,
        });

        // Auto-stop after VIDEO_DURATION_MS
        const stopTimer = setTimeout(() => {
          camera.stopRecording();
        }, VIDEO_DURATION_MS);

        const video = await videoPromise;
        clearTimeout(stopTimer);

        if (video?.uri) {
          console.log("[SOS-CAPTURE] Video recorded:", video.uri);
          const ok = await uploadFile(video.uri, "video/mp4", "video", incidentId, authToken);
          updateStatus({ videoUploaded: ok });

          // Clean up temp file
          FileSystem.deleteAsync(video.uri, { idempotent: true }).catch(() => {});
        }
      } catch (err) {
        console.error("[SOS-CAPTURE] Video recording failed:", err);
        updateStatus({ error: "Video recording failed" });
      }

      updateStatus({ capturing: false });
      console.log("[SOS-CAPTURE] Capture sequence complete");
    },
    []
  );

  return {
    cameraRef,
    status: statusRef.current,
    captureAndUpload,
  };
}
