"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { InputState } from "@/game/input";
import type { HudSnapshot } from "@/game/hud";

/**
 * Mobile controls: left virtual joystick, full-screen look drag on the
 * right, and context-aware action buttons (on-foot combat or vehicle
 * driver/passenger seats).
 */
export default function TouchControls({
  input,
  hud,
}: {
  input: InputState;
  hud: HudSnapshot;
}) {
  const stickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const stickPointer = useRef<number | null>(null);
  const lookPointer = useRef<number | null>(null);
  const lastLook = useRef({ x: 0, y: 0 });
  const [firing, setFiring] = useState(false);
  const [aiming, setAiming] = useState(false);

  // A gesture must not survive focus loss: hard-clear the smoother and drop
  // any in-flight look pointer when the tab is hidden or the window blurs.
  useEffect(() => {
    const hardClear = () => {
      lookPointer.current = null;
      input.touchLook.clear();
    };
    const onVisibility = () => {
      if (document.hidden) hardClear();
    };
    window.addEventListener("blur", hardClear);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", hardClear);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [input]);

  const handleStick = (e: ReactPointerEvent) => {
    const el = stickRef.current;
    const knob = knobRef.current;
    if (!el || !knob) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const max = rect.width / 2;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    input.moveX = dx / max;
    input.moveY = -dy / max;
  };

  const resetStick = () => {
    stickPointer.current = null;
    if (knobRef.current) knobRef.current.style.transform = "translate(0,0)";
    input.moveX = 0;
    input.moveY = 0;
  };

  const inVehicle = hud.inVehicle;

  return (
    <div className="touch-layer">
      {/* Right-side look area (sits behind all buttons/joystick) */}
      <div
        className="look-pad"
        onPointerDown={(e) => {
          if (lookPointer.current !== null) return;
          lookPointer.current = e.pointerId;
          lastLook.current = { x: e.clientX, y: e.clientY };
          input.touchLook.begin();
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (lookPointer.current !== e.pointerId) return;
          input.touchLook.move(
            e.clientX - lastLook.current.x,
            e.clientY - lastLook.current.y
          );
          lastLook.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          if (lookPointer.current === e.pointerId) {
            lookPointer.current = null;
            // Keep the smoothed tail; it drains over the next frames.
            input.touchLook.end();
          }
        }}
        onPointerCancel={(e) => {
          if (lookPointer.current === e.pointerId) {
            lookPointer.current = null;
            input.touchLook.clear();
          }
        }}
      />

      {/* Left joystick (drives vehicles when seated) */}
      <div
        className="joystick"
        ref={stickRef}
        onPointerDown={(e) => {
          e.stopPropagation();
          stickPointer.current = e.pointerId;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          handleStick(e);
        }}
        onPointerMove={(e) => {
          if (stickPointer.current === e.pointerId) handleStick(e);
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          if (stickPointer.current === e.pointerId) resetStick();
        }}
        onPointerCancel={resetStick}
      >
        <div className="joystick-knob" ref={knobRef} />
      </div>

      {!inVehicle ? (
        <div className="action-cluster">
          {hud.canEnterVehicle && (
            <button
              className="action-btn enter"
              onPointerDown={(e) => {
                e.stopPropagation();
                input.queueEnter();
              }}
            >
              Enter
            </button>
          )}
          <button
            className={`action-btn fire ${firing ? "held" : ""}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              setFiring(true);
              input.firing = true;
            }}
            onPointerUp={() => {
              setFiring(false);
              input.firing = false;
            }}
            onPointerCancel={() => {
              setFiring(false);
              input.firing = false;
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            Fire
          </button>
          <button
            className={`action-btn ${aiming ? "held" : ""}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              setAiming(true);
              input.aiming = true;
            }}
            onPointerUp={() => {
              setAiming(false);
              input.aiming = false;
            }}
            onPointerCancel={() => {
              setAiming(false);
              input.aiming = false;
            }}
          >
            Aim
          </button>
          <button
            className="action-btn"
            onPointerDown={(e) => {
              e.stopPropagation();
              input.queueJump();
            }}
          >
            Jump
          </button>
          <button
            className="action-btn"
            onPointerDown={(e) => {
              e.stopPropagation();
              input.queueReload();
            }}
          >
            Reload
          </button>
        </div>
      ) : (
        <div className="action-cluster vehicle-cluster">
          {hud.gunnerActive && (
            <button
              className={`action-btn fire ${firing ? "held" : ""}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                setFiring(true);
                input.firing = true;
              }}
              onPointerUp={() => {
                setFiring(false);
                input.firing = false;
              }}
              onPointerCancel={() => {
                setFiring(false);
                input.firing = false;
              }}
            >
              Gun
            </button>
          )}
          <button
            className="action-btn"
            onPointerDown={(e) => {
              e.stopPropagation();
              input.queueSwapSeat();
            }}
          >
            Swap
          </button>
          <button
            className="action-btn exit"
            onPointerDown={(e) => {
              e.stopPropagation();
              input.queueExit();
            }}
          >
            Exit
          </button>
        </div>
      )}
    </div>
  );
}
