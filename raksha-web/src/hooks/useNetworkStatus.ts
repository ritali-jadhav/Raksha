import { useState, useEffect } from 'react';

interface NetworkStatus {
  online: boolean;
  effectiveType: string | null;
  reconnecting: boolean;
}

/**
 * Hook to track network connectivity status.
 * Shows offline banner and reconnecting state.
 */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    online: navigator.onLine,
    effectiveType: (navigator as any).connection?.effectiveType || null,
    reconnecting: false,
  });

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const handleOnline = () => {
      setStatus(prev => ({ ...prev, online: true, reconnecting: false }));
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };

    const handleOffline = () => {
      setStatus(prev => ({ ...prev, online: false, reconnecting: true }));
    };

    const handleConnectionChange = () => {
      setStatus(prev => ({
        ...prev,
        effectiveType: (navigator as any).connection?.effectiveType || null,
      }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const connection = (navigator as any).connection;
    if (connection) {
      connection.addEventListener('change', handleConnectionChange);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (connection) {
        connection.removeEventListener('change', handleConnectionChange);
      }
    };
  }, []);

  return status;
}
