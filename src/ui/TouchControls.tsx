/*
 * Mobile-first immersive touch layer. Left half = dynamic virtual
 * joystick (origin at thumb contact), right half = drag look, plus
 * sprint/crouch/jump action buttons. Feeds the shared InputBus; no
 * game state lives here.
 */

import { useRef, useState } from "react";
import type { InputBus } from "../player/input";

interface Props {
  bus: InputBus;
}

interface Stick {
  id: number;
  originX: number;
  originY: number;
  knobX: number;
  knobY: number;
}

const STICK_RADIUS = 56;

export function TouchControls({ bus }: Props): JSX.Element {
  const [stick, setStick] = useState<Stick | null>(null);
  const lookId = useRef<number | null>(null);
  const lastLook = useRef({ x: 0, y: 0 });
  const [crouching, setCrouching] = useState(false);

  const startStick = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setStick({ id: e.pointerId, originX: e.clientX, originY: e.clientY, knobX: e.clientX, knobY: e.clientY });
  };

  const moveStick = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!stick || e.pointerId !== stick.id) return;
    let dx = e.clientX - stick.originX;
    let dy = e.clientY - stick.originY;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    setStick({ ...stick, knobX: stick.originX + dx, knobY: stick.originY + dy });
    bus.setJoystick(dx / STICK_RADIUS, -dy / STICK_RADIUS);
  };

  const endStick = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!stick || e.pointerId !== stick.id) return;
    bus.setJoystick(0, 0);
    setStick(null);
  };

  const startLook = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    lookId.current = e.pointerId;
    lastLook.current = { x: e.clientX, y: e.clientY };
  };

  const moveLook = (e: React.PointerEvent<HTMLDivElement>) => {
    if (lookId.current !== e.pointerId) return;
    bus.addTouchLook(e.clientX - lastLook.current.x, e.clientY - lastLook.current.y);
    lastLook.current = { x: e.clientX, y: e.clientY };
  };

  const endLook = (e: React.PointerEvent<HTMLDivElement>) => {
    if (lookId.current === e.pointerId) lookId.current = null;
  };

  return (
    <div className="touch-layer" aria-hidden="true">
      <div
        className="touch-zone touch-move"
        onPointerDown={startStick}
        onPointerMove={moveStick}
        onPointerUp={endStick}
        onPointerCancel={endStick}
      >
        {stick && (
          <>
            <span className="stick-base" style={{ left: stick.originX, top: stick.originY }} />
            <span className="stick-knob" style={{ left: stick.knobX, top: stick.knobY }} />
          </>
        )}
      </div>
      <div
        className="touch-zone touch-look"
        onPointerDown={startLook}
        onPointerMove={moveLook}
        onPointerUp={endLook}
        onPointerCancel={endLook}
      />
      <div className="touch-actions">
        <button
          className="touch-btn touch-btn-sprint"
          onPointerDown={(e) => { e.preventDefault(); bus.setSprint(true); }}
          onPointerUp={() => bus.setSprint(false)}
          onPointerCancel={() => bus.setSprint(false)}
        >
          run
        </button>
        <button
          className={`touch-btn ${crouching ? "is-on" : ""}`}
          onPointerDown={(e) => {
            e.preventDefault();
            const next = !crouching;
            setCrouching(next);
            bus.setCrouch(next);
          }}
        >
          crouch
        </button>
        <button
          className="touch-btn touch-btn-jump"
          onPointerDown={(e) => { e.preventDefault(); bus.queueJump(); }}
        >
          jump
        </button>
      </div>
    </div>
  );
}
