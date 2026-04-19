import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

function normalizeBaseUrl(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function resolveSocketUrl(): string {
  const fromEnv = (import.meta as any)?.env?.VITE_SOCKET_URL as string | undefined;
  if (fromEnv && fromEnv.trim()) return normalizeBaseUrl(fromEnv.trim());

  // Local web dev fallback (works in browser, NOT on a real phone APK).
  return 'http://localhost:4000';
}

const SOCKET_URL = resolveSocketUrl();

interface SocketState {
  socket: Socket | null;
  connected: boolean;
  sosAlerts: SOSAlert[];
  dismissAlert: (incidentId: string) => void;
  clearAlerts: () => void;
}

export interface SOSAlert {
  incidentId: string;
  protectedUserId: string;
  userName: string;
  triggerType: string;
  status: 'active' | 'cancelled' | 'resolved';
  timestamp: string;
  lat?: number;
  lng?: number;
  mediaUrl?: string;
  mediaType?: string;
  userPhone?: string | null; // user's real phone number for guardian callback
}

const SocketContext = createContext<SocketState>({
  socket: null,
  connected: false,
  sosAlerts: [],
  dismissAlert: () => {},
  clearAlerts: () => {},
});

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [sosAlerts, setSOSAlerts] = useState<SOSAlert[]>([]);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token || !user) {
      // Disconnect if logged out
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
        setConnected(false);
      }
      return;
    }

    // Create socket connection
    const newSocket = io(SOCKET_URL, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
    });

    newSocket.on('connect', () => {
      console.log('[SOCKET] Connected:', newSocket.id);
      setConnected(true);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('[SOCKET] Disconnected:', reason);
      setConnected(false);
    });

    newSocket.on('reconnect', (attempt) => {
      console.log('[SOCKET] Reconnected after', attempt, 'attempts');
      setConnected(true);
    });

    newSocket.on('connect_error', (err) => {
      console.warn('[SOCKET] Connection error:', err.message);
    });

    // Listen for SOS events
    newSocket.on('sos:triggered', (data: any) => {
      console.log('[SOCKET] SOS Triggered:', data);
      setSOSAlerts(prev => {
        // Don't duplicate
        if (prev.some(a => a.incidentId === data.incidentId)) return prev;
        return [...prev, {
          incidentId: data.incidentId,
          protectedUserId: data.protectedUserId,
          userName: data.userName,
          triggerType: data.triggerType,
          status: 'active',
          timestamp: data.timestamp,
          userPhone: data.userPhone || null,
        }];
      });
    });

    newSocket.on('sos:cancelled', (data: any) => {
      console.log('[SOCKET] SOS Cancelled:', data);
      setSOSAlerts(prev =>
        prev.map(a =>
          a.incidentId === data.incidentId ? { ...a, status: 'cancelled' as const } : a
        )
      );
    });

    newSocket.on('sos:resolved', (data: any) => {
      console.log('[SOCKET] SOS Resolved:', data);
      setSOSAlerts(prev =>
        prev.map(a =>
          a.incidentId === data.incidentId ? { ...a, status: 'resolved' as const } : a
        )
      );
    });

    // Listen for real-time location updates
    newSocket.on('location:update', (data: any) => {
      setSOSAlerts(prev =>
        prev.map(a =>
          a.protectedUserId === data.protectedUserId
            ? { ...a, lat: data.lat, lng: data.lng }
            : a
        )
      );
    });

    // Listen for media captured events (Cloudinary upload completed)
    newSocket.on('sos:media-captured', (data: any) => {
      console.log('[SOCKET] Media captured:', data);
      setSOSAlerts(prev =>
        prev.map(a =>
          a.incidentId === data.incidentId
            ? { ...a, mediaUrl: data.mediaUrl, mediaType: data.mediaType }
            : a
        )
      );
    });

    socketRef.current = newSocket;
    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
      socketRef.current = null;
    };
  }, [token, user]);

  const dismissAlert = (incidentId: string) => {
    setSOSAlerts(prev => prev.filter(a => a.incidentId !== incidentId));
  };

  const clearAlerts = () => {
    setSOSAlerts([]);
  };

  return (
    <SocketContext.Provider value={{ socket, connected, sosAlerts, dismissAlert, clearAlerts }}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
