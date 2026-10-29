import { defineConfig } from "vite";

// IRONVEIL dev/preview server. Binds all interfaces on 8000 so the Arena
// live preview (https://8000-<sandbox>.e2b.app) can reach it.
export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 8000,
    strictPort: true,
    allowedHosts: true,
    hmr: { clientPort: 443 },
  },
  preview: {
    host: "0.0.0.0",
    port: 8000,
    strictPort: true,
    allowedHosts: true,
  },
});
