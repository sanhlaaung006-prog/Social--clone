import { defineConfig } from "vite";

// IRONVEIL dev/preview server. Binds all interfaces on 8000 so the Arena
// live preview (https://8000-<sandbox>.e2b.app) can reach it.
export default defineConfig({
  // Relative asset paths: the same build works on a root domain
  // (Vercel), a repo subpath (GitHub Pages) and the Arena preview.
  base: "./",
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
