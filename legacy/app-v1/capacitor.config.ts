import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wraps the static Vite build (`dist/`) in an Android WebView.
 * The same WebGL/Three.js build runs inside the APK; the browser build at the
 * same URL remains the fallback. Vite's relative base ("./") means all asset
 * and WASM paths resolve against the WebView's bundled origin.
 */
const config: CapacitorConfig = {
  appId: "ai.goldenland.royale",
  appName: "Golden Land Royale",
  webDir: "dist",
  android: {
    allowMixedContent: false,
    backgroundColor: "#bfd4c0",
  },
};

export default config;
