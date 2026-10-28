import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./globals.css";

// StrictMode is intentionally omitted: its dev double-mount would create
// two WebGL terrain engines, and the locked ReliefTerrain owns a RAF loop
// with no dispose hook. Production renders are single-mount regardless.
const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root mount point missing");

createRoot(rootEl).render(<App />);
