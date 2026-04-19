import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.raksha.app',
  appName: 'Raksha',
  webDir: 'dist',
  server: {
    // Allow HTTP cleartext for development/staging backends
    // In production, replace with HTTPS and remove cleartext: true
    cleartext: true,
    allowNavigation: ['*'],
    hostname: 'raksha.app',
  },
  android: {
    // Allow mixed content (HTTP + HTTPS) in WebView — needed when backend is HTTP
    allowMixedContent: true,
    // Ensure geolocation works on Android
    useLegacyBridge: false,
  },
  plugins: {
    // Capacitor HTTP plugin for native fetch support
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;

