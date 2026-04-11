// Service Worker for Raksha Push Notifications
/* eslint-disable no-restricted-globals */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle push notifications
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: "Raksha Alert",
      body: event.data.text(),
    };
  }

  const options = {
    body: payload.body || "",
    icon: payload.icon || "/shield-icon.png",
    badge: payload.badge || "/shield-badge.png",
    tag: payload.tag || "raksha-notification",
    data: payload.data || {},
    actions: payload.actions || [],
    requireInteraction: payload.requireInteraction || false,
    vibrate: payload.vibrate || [200, 100, 200],
    timestamp: Date.now(),
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || "Raksha", options)
  );
});

// Handle notification click
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const url = data.url || "/";

  // Handle action buttons
  if (event.action === "track") {
    event.waitUntil(openOrFocus("/guardians?action=track"));
    return;
  }
  if (event.action === "call") {
    event.waitUntil(openOrFocus("/guardians?action=call"));
    return;
  }

  event.waitUntil(openOrFocus(url));
});

async function openOrFocus(url) {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  // Focus existing window if available
  for (const client of clients) {
    if (client.url.includes(self.location.origin)) {
      client.focus();
      client.navigate(url);
      return;
    }
  }

  // Open new window
  return self.clients.openWindow(url);
}
