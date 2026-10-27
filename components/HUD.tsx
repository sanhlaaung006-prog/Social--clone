"use client";

import { useEffect, useRef, useState } from "react";
import type { HudSnapshot } from "@/game/hud";
import Minimap from "./Minimap";

function fmt(t: number) {
  const s = Math.ceil(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function HUD({
  hud,
  touch,
  onDeploy,
}: {
  hud: HudSnapshot;
  touch: boolean;
  onDeploy: () => void;
}) {
  const [showHit, setShowHit] = useState(false);
  const [showDamage, setShowDamage] = useState(false);
  const lastHit = useRef(-1);
  const lastDmg = useRef(-1);

  useEffect(() => {
    if (hud.hitMarkerAt !== lastHit.current && hud.hitMarkerAt > 0) {
      lastHit.current = hud.hitMarkerAt;
      setShowHit(true);
      const t = setTimeout(() => setShowHit(false), 180);
      return () => clearTimeout(t);
    }
  }, [hud.hitMarkerAt]);

  useEffect(() => {
    if (hud.damageAt !== lastDmg.current && hud.damageAt > 0) {
      lastDmg.current = hud.damageAt;
      setShowDamage(true);
      const t = setTimeout(() => setShowDamage(false), 500);
      return () => clearTimeout(t);
    }
  }, [hud.damageAt]);

  const hpRatio = (hud.hp / hud.maxHp) * 100;

  /* ------------------------------- menu ------------------------------- */
  if (hud.status === "menu") {
    return (
      <div className="overlay">
        <div className="menu-card">
          <h1>GOLDEN LAND</h1>
          <p className="tagline">Low-poly battle royale</p>
          <div className="controls">
            {touch ? (
              <>
                <b>Mobile controls</b>
                <br />• Left stick — move
                <br />• Drag right side — look
                <br />• Fire / Aim / Jump / Reload buttons
                <br />• Stay inside the blue circle. Last one standing wins.
              </>
            ) : (
              <>
                <b>Desktop controls</b>
                <br />• Click screen to capture mouse
                <br />• WASD move · Shift sprint · Space jump
                <br />• Left click fire · Right click aim · R reload
                <br />• Stay inside the blue circle. Last one standing wins.
              </>
            )}
          </div>
          <p className="wasm-line">
            Math core: {hud.wasmReady ? "clang/WebAssembly module ✓" : "JS fallback (run npm run build:wasm)"}
          </p>
          <button className="deploy-btn" onClick={onDeploy}>
            Deploy
          </button>
        </div>
      </div>
    );
  }

  /* --------------------------- death / victory -------------------------- */
  if (hud.status === "dead" || hud.status === "won") {
    return (
      <div className="overlay">
        <div className="menu-card">
          <h1 style={{ color: hud.status === "won" ? "#9be36d" : "#ff6f68" }}>
            {hud.status === "won" ? "VICTORY" : "ELIMINATED"}
          </h1>
          <p className="tagline">
            {hud.status === "won" ? "Last fighter standing" : "The Golden Land is unforgiving"}
          </p>
          <div className="result-stats">
            <div className="result-stat">
              <b>#{hud.placement}</b>
              <span>placement</span>
            </div>
            <div className="result-stat">
              <b>{hud.kills}</b>
              <span>eliminations</span>
            </div>
          </div>
          <button className="deploy-btn" onClick={onDeploy}>
            Redeploy
          </button>
        </div>
      </div>
    );
  }

  /* -------------------------------- in-game ------------------------------- */
  return (
    <div className="hud">
      <div className="hud-stats">
        <div className="hud-panel">☠ {hud.kills} kills</div>
        <div className="hud-panel">
          {hud.alive} alive
        </div>
      </div>

      <div className="hud-top hud-panel">
        <span className={`zone-state-${hud.zoneState}`}>
          {hud.zoneState === "shrinking" ? "ZONE SHRINKING" : "NEXT ZONE"}
        </span>
        <span>
          Phase {hud.zonePhase}/{hud.zonePhases} · {fmt(hud.zoneTimer)}
        </span>
      </div>

      <Minimap hud={hud} />

      <div className="kill-feed">
        {hud.killFeed.map((k) => (
          <span key={k.id}>{k.text}</span>
        ))}
      </div>

      <div className="crosshair" />
      {showHit && <div className="hitmarker" />}
      {showDamage && <div className="damage-vignette" />}
      {hud.outsideZone && <div className="zone-warning">OUTSIDE SAFE ZONE — {hud.zoneState === "shrinking" ? "MOVE!" : "GET INSIDE"}</div>}

      <div className="hud-bottom">
        <div className="health-label">HP {hud.hp}</div>
        <div className="health-track">
          <div
            className="health-fill"
            style={{ width: `${hpRatio}%`, background: hpRatio < 30 ? "linear-gradient(90deg,#c9413b,#ff8a66)" : undefined }}
          />
        </div>
      </div>

      <div className={`ammo hud-panel ${hud.reloading ? "reload" : ""}`}>
        {hud.reloading ? "RELOADING…" : (
          <>
            {hud.mag} <small>/ {hud.reserve}</small>
          </>
        )}
      </div>

      {!touch && !hud.pointerLocked && (
        <div className="lock-hint">Click to capture mouse and look around</div>
      )}
    </div>
  );
}
