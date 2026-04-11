import { useEffect, useRef } from 'react';
import { api } from '../api/client';

/**
 * Hook to register for Web Push Notifications.
 * Requests permission, subscribes, and sends subscription to backend.
 */
export function usePushNotifications(enabled: boolean = true) {
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (!enabled || subscribedRef.current) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.log('[PUSH] Push notifications not supported');
      return;
    }

    const setup = async () => {
      try {
        // Register service worker
        const registration = await navigator.serviceWorker.register('/sw.js');
        console.log('[PUSH] Service Worker registered');

        // Request notification permission
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          console.log('[PUSH] Permission denied');
          return;
        }

        // Get VAPID key from server
        let vapidKey: string;
        try {
          const res = await api('/push/vapid-key');
          vapidKey = res.publicKey;
        } catch {
          console.log('[PUSH] VAPID key not available, skipping subscription');
          return;
        }

        if (!vapidKey) return;

        // Subscribe to push
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
        });

        // Send subscription to backend
        await api('/push/subscribe', {
          method: 'POST',
          body: JSON.stringify({ subscription }),
        });

        subscribedRef.current = true;
        console.log('[PUSH] Push subscription active');
      } catch (err) {
        console.error('[PUSH] Setup failed:', err);
      }
    };

    setup();
  }, [enabled]);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
