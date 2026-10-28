import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  // Relative base so the same build works from the Capacitor WebView origin
  // and any static host subpath.
  base: "./",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        // three.js is the heavy dependency; keep it in its own cacheable chunk.
        manualChunks: {
          three: ["three"],
          react: ["react", "react-dom"],
        },
      },
    },
  },
  // The legacy/ tree holds archived standalone HTML demos; only the live
  // root entry belongs in dep pre-bundling or the file watcher.
  optimizeDeps: {
    entries: ["index.html"],
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    watch: {
      ignored: ["**/legacy/**"],
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
});
