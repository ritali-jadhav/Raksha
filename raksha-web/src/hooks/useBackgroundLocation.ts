import { useState, useEffect, useRef, useCallback } from 'react';
import { locationApi, sosApi, API_BASE } from '../api/client';
import { useSocket } from '../context/SocketContext';

interface BackgroundLocationState {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  isTracking: boolean;
  isBackground: boolean;
  error: string | null;
}

/**
 * Hook for continuous location tracking that survives tab backgrounding.
 * Uses Web Lock API to prevent throttling + keepalive fetch for tab close.
 * sendBeacon replaced with fetch({keepalive:true}) to support auth headers in APK.
 */
export function useBackgroundLocation(active: boolean) {
  const [state, setState] = useState<BackgroundLocationState>({
    lat: null, lng: null, accuracy: null,
    isTracking: false, isBackground: false, error: null,
  });
  const socketCtx = useSocket();
  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const lockRef = useRef<any>(null);
  // Keep a ref to latest coords so beforeunload handler always has fresh values (no stale closure)
  const latestCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

  // Track page visibility
  useEffect(() => {
    const handleVisibility = () => {
      setState(prev => ({ ...prev, isBackground: document.hidden }));
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const sendLocation = useCallback((lat: number, lng: number) => {
    setState(prev => ({ ...prev, lat, lng, isTracking: true }));
    // Keep ref fresh for beforeunload
    latestCoordsRef.current = { lat, lng };

    // Send to server APIs
    sosApi.locationUpdate(lat, lng).catch(() => {});
    locationApi.update(lat, lng).catch(() => {});

    // Also emit via WebSocket for real-time guardian updates
    if (socketCtx.socket?.connected) {
      socketCtx.socket.emit('location:share', { lat, lng });
    }
  }, [socketCtx.socket]);

  useEffect(() => {
    if (!active) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (intervalRef.current) clearInterval(intervalRef.current);
      setState(prev => ({ ...prev, isTracking: false }));
      return;
    }

    if (!navigator.geolocation) {
      setState(prev => ({ ...prev, error: 'Geolocation not supported' }));
      return;
    }

    // Use watchPosition for continuous tracking
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        sendLocation(pos.coords.latitude, pos.coords.longitude);
        setState(prev => ({ ...prev, accuracy: pos.coords.accuracy, error: null }));
      },
      (err) => {
        setState(prev => ({ ...prev, error: err.message }));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 10000,
      }
    );

    // Fallback: periodic polling every 8s (helps when watchPosition throttles in background)
    intervalRef.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (pos) => sendLocation(pos.coords.latitude, pos.coords.longitude),
        () => {},
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 5000 }
      );
    }, 8000);

    // Request Web Lock to prevent throttling in background
    if ('locks' in navigator) {
      (navigator as any).locks.request('raksha-location-tracking', { mode: 'exclusive' }, () => {
        return new Promise<void>((resolve) => {
          lockRef.current = resolve;
        });
      }).catch(() => {});
    }

    // Request Wake Lock to keep screen alive during SOS
    let wakeLock: any = null;
    if ('wakeLock' in navigator) {
      (navigator as any).wakeLock.request('screen')
        .then((wl: any) => { wakeLock = wl; })
        .catch(() => {});
    }

    // Send location on page close using keepalive fetch (works in APK + browser).
    // sendBeacon can't send auth headers, so we use fetch with keepalive:true instead.
    const handleBeforeUnload = () => {
      const coords = latestCoordsRef.current;
      const token = localStorage.getItem('raksha_token');
      if (coords && token) {
        fetch(`${API_BASE}/sos/location-update`, {
          method: 'POST',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ lat: coords.lat, lng: coords.lng }),
        }).catch(() => {});
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (lockRef.current) lockRef.current();
      if (wakeLock) wakeLock.release().catch(() => {});
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [active, sendLocation]);

  return state;
}
