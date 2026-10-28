import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./globals.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root mount point missing");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
