function normalizeBaseUrl(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function resolveApiBase(): string {
  // Vite injects envs at build-time. For APK builds you MUST set this to a real reachable host.
  const fromEnv = (import.meta as any)?.env?.VITE_API_BASE as string | undefined;
  if (fromEnv && fromEnv.trim()) return normalizeBaseUrl(fromEnv.trim());

  // Local web dev fallback (works in browser, NOT on a real phone APK).
  return 'http://localhost:4000';
}

const API_BASE = resolveApiBase();

// ===== Retry & Resilience Configuration =====
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // ms
const REQUEST_TIMEOUT = 15000; // ms

// Offline request queue
interface QueuedRequest {
  path: string;
  options: RequestInit;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

const offlineQueue: QueuedRequest[] = [];
let isProcessingQueue = false;

// Listen for online event to replay queued requests
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    processOfflineQueue();
  });
}

async function processOfflineQueue() {
  if (isProcessingQueue || offlineQueue.length === 0) return;
  isProcessingQueue = true;

  console.log(`[API] Processing ${offlineQueue.length} queued requests`);

  while (offlineQueue.length > 0) {
    const req = offlineQueue.shift()!;
    try {
      const result = await api(req.path, req.options);
      req.resolve(result);
    } catch (err) {
      req.reject(err);
    }
  }

  isProcessingQueue = false;
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with timeout
 */
function fetchWithTimeout(url: string, options: RequestInit, timeout: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Request timed out'));
    }, timeout);

    fetch(url, { ...options, signal: controller.signal })
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

/**
 * Core API function with retry logic, timeout, and offline queue
 */
export async function api(
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const token = localStorage.getItem('raksha_token');

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Don't set Content-Type for FormData (browser sets it with boundary)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const requestOptions: RequestInit = {
    ...options,
    headers,
  };

  // Check if offline — queue non-GET requests
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    if (options.method && options.method !== 'GET') {
      return new Promise((resolve, reject) => {
        offlineQueue.push({ path, options: requestOptions, resolve, reject });
        console.log(`[API] Queued offline request: ${path}`);
      });
    }
    throw new Error('No network connection');
  }

  // Retry with exponential backoff
  let lastError: Error = new Error('Request failed');
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(
        `${API_BASE}${path}`,
        requestOptions,
        REQUEST_TIMEOUT
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Request failed: ${res.status}`);
      }

      return data;
    } catch (err: any) {
      lastError = err;

      // Don't retry on auth errors or client errors (4xx except 429)
      if (err.message?.includes('401') || err.message?.includes('403')) {
        throw err;
      }

      // Retry on network errors, timeouts, and 5xx
      if (attempt < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(`[API] Retry ${attempt + 1}/${MAX_RETRIES} for ${path} in ${delay}ms`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

export const authApi = {
  signup: (body: { email: string; password: string; name: string; phone?: string; safetyPin?: string }) =>
    api('/auth/signup', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    api('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  me: () => api('/auth/me'),
  updatePin: (newPin: string) =>
    api('/auth/safety-pin', { method: 'PUT', body: JSON.stringify({ newPin }) }),
};

export const sosApi = {
  trigger: (triggerType = 'manual', latitude?: number, longitude?: number) =>
    api('/sos/trigger', { method: 'POST', body: JSON.stringify({ triggerType, latitude, longitude }) }),
  verifyPin: (incidentId: string, pin: string) =>
    api('/sos/verify-pin', { method: 'POST', body: JSON.stringify({ incidentId, pin }) }),
  locationUpdate: (lat: number, lng: number) =>
    api('/sos/location-update', { method: 'POST', body: JSON.stringify({ lat, lng }) }),
  attachMedia: (incidentId: string, file: File | Blob, type: 'image' | 'video' | 'audio' = 'image') => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('incidentId', incidentId);
    formData.append('type', type);
    return api('/sos/attach-media', { method: 'POST', body: formData });
  },
  incidents: () => api('/sos/incidents'),
  incident: (id: string) => api(`/sos/incident/${id}`),
  resolve: (incidentId: string) =>
    api('/sos/resolve', { method: 'POST', body: JSON.stringify({ incidentId }) }),
};

export const guardianApi = {
  myGuardians: () => api('/guardian/my-guardians'),
  myProtected: () => api('/guardian/my-protected'),
  pending: () => api('/guardian/pending'),
  inviteByEmail: (email: string) =>
    api('/guardian/invite-by-email', { method: 'POST', body: JSON.stringify({ email }) }),
  confirm: (linkId: string) =>
    api('/guardian/confirm', { method: 'POST', body: JSON.stringify({ linkId }) }),
  reject: (linkId: string) =>
    api('/guardian/reject', { method: 'POST', body: JSON.stringify({ linkId }) }),
  remove: (linkId: string) =>
    api(`/guardian/${linkId}`, { method: 'DELETE' }),
  dashboard: () => api('/guardian/dashboard'),
  notifications: () => api('/guardian/notifications'),
  markRead: (id: string) =>
    api(`/guardian/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () =>
    api('/guardian/notifications/read-all', { method: 'POST' }),
  // External phone-only guardians
  addPhone: (name: string, phone: string) =>
    api('/guardian/add-phone', { method: 'POST', body: JSON.stringify({ name, phone }) }),
  phoneGuardians: () => api('/guardian/phone-guardians'),
  removePhone: (id: string) =>
    api(`/guardian/phone/${id}`, { method: 'DELETE' }),
};

export const geofenceApi = {
  list: () => api('/geofence/list'),
  create: (body: { centerLat: number; centerLng: number; radiusMeters: number; name?: string }) =>
    api('/geofence/create', { method: 'POST', body: JSON.stringify(body) }),
  remove: (id: string) => api(`/geofence/${id}`, { method: 'DELETE' }),
};

export const locationApi = {
  update: (lat: number, lng: number) =>
    api('/location/update', { method: 'POST', body: JSON.stringify({ lat, lng }) }),
  heartbeat: () => api('/location/heartbeat', { method: 'POST' }),
  live: (userId: string) => api(`/live-location/${userId}`),
};

export const evidenceApi = {
  list: (incidentId: string) => api(`/evidence/${incidentId}`),
  upload: (incidentId: string, file: File, type: 'image' | 'video' | 'audio') => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('incidentId', incidentId);
    formData.append('type', type);
    return api('/evidence/upload', { method: 'POST', body: formData });
  },
};

export const checkinApi = {
  startTimer: (durationMinutes: number, label?: string) =>
    api('/checkin/timer', { method: 'POST', body: JSON.stringify({ durationMinutes, label }) }),
  confirm: (timerId: string) =>
    api('/checkin/confirm', { method: 'POST', body: JSON.stringify({ timerId }) }),
  cancel: (timerId: string) =>
    api('/checkin/cancel', { method: 'POST', body: JSON.stringify({ timerId }) }),
  active: () => api('/checkin/active'),
};

export const journeyApi = {
  start: (body: { destination: string; destLat: number; destLng: number; etaMinutes: number }) =>
    api('/journey/start', { method: 'POST', body: JSON.stringify(body) }),
  arrived: (journeyId: string) =>
    api('/journey/arrived', { method: 'POST', body: JSON.stringify({ journeyId }) }),
  cancel: (journeyId: string) =>
    api('/journey/cancel', { method: 'POST', body: JSON.stringify({ journeyId }) }),
  active: () => api('/journey/active'),
};

export const communityApi = {
  report: (body: { lat: number; lng: number; type: string; description?: string }) =>
    api('/community/report', { method: 'POST', body: JSON.stringify(body) }),
  nearby: (lat: number, lng: number, radiusKm = 5) =>
    api(`/community/nearby?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`),
  upvote: (id: string) =>
    api(`/community/upvote/${id}`, { method: 'POST' }),
};

export const analyticsApi = {
  crimeTrends: (city?: string) =>
    api(`/analytics/crime-trends${city ? `?city=${encodeURIComponent(city)}` : ''}`),
  topCities: () => api('/analytics/top-cities'),
};
