import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.raksha.app',
  appName: 'Raksha',
  webDir: 'dist',
  plugins: {
    // Allow mixed content for HTTP fallback during dev
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
