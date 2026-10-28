/*
 * Unified input state. Touch UI (components/TouchControls.tsx) and desktop
 * keyboard/mouse listeners both write here; the engine reads it every frame.
 */

import { TouchAim, AIM_GAIN } from "./touchAim";

export class InputState {
  /** Normalized movement vector from the virtual joystick / WASD. */
  moveX = 0;
  moveY = 0;
  /** Accumulated look deltas (engine consumes and resets). */
  lookDX = 0;
  lookDY = 0;

  /** Touch-only look-gesture filter (slop + low-pass). Desktop mouse
   *  bypasses it and writes lookDX/lookDY directly. */
  readonly touchLook = new TouchAim();

  firing = false;
  aiming = false;
  sprint = false;
  jumpQueued = false;
  reloadQueued = false;
  enterQueued = false;
  exitQueued = false;
  swapQueued = false;

  /** Touch device flag, set by the React layer after media-query detection. */
  touch = false;

  consumeLook(): { dx: number; dy: number } {
    const out = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return out;
  }

  /** Move one frame of smoothed touch look into the raw look accumulator.
   *  Called once per engine frame before either on-foot or vehicle code
   *  consumes look. No-op for desktop since the touch queue stays empty. */
  pumpTouchLook(dt: number): void {
    const d = this.touchLook.pump(dt, this.aiming ? AIM_GAIN : 1);
    this.lookDX += d.dx;
    this.lookDY += d.dy;
  }

  queueJump() {
    this.jumpQueued = true;
  }

  queueReload() {
    this.reloadQueued = true;
  }

  queueEnter() {
    this.enterQueued = true;
  }

  queueExit() {
    this.exitQueued = true;
  }

  queueSwapSeat() {
    this.swapQueued = true;
  }

  resetTransient() {
    this.jumpQueued = false;
    this.reloadQueued = false;
    this.enterQueued = false;
    this.exitQueued = false;
    this.swapQueued = false;
  }
}

/** Desktop keyboard/mouse bindings (touch is handled entirely in React). */
export function attachDesktopInput(
  input: InputState,
  domElement: HTMLElement,
  onLockChange?: (locked: boolean) => void
): () => void {
  const keys = new Set<string>();

  const recomputeMove = () => {
    const f = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const r = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const len = Math.hypot(f, r) || 1;
    input.moveX = r / len;
    input.moveY = f / len;
    input.sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === "Space") {
      e.preventDefault();
      input.queueJump();
    }
    if (e.code === "KeyR") input.queueReload();
    if (e.code === "KeyE") input.queueEnter();
    if (e.code === "KeyF") input.queueSwapSeat();
    if (e.code === "KeyG") input.queueExit();
    recomputeMove();
  };

  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.code);
    recomputeMove();
  };

  const onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== domElement) return;
    input.lookDX += e.movementX;
    input.lookDY += e.movementY;
  };

  const onMouseDown = (e: MouseEvent) => {
    if (document.pointerLockElement !== domElement) {
      domElement.requestPointerLock?.();
      return;
    }
    if (e.button === 0) input.firing = true;
    if (e.button === 2) input.aiming = true;
  };

  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.aiming = false;
  };

  const onContext = (e: Event) => e.preventDefault();

  const onLock = () => onLockChange?.(document.pointerLockElement === domElement);

  const onBlur = () => {
    keys.clear();
    input.firing = false;
    input.aiming = false;
    recomputeMove();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("blur", onBlur);
  domElement.addEventListener("contextmenu", onContext);
  document.addEventListener("pointerlockchange", onLock);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mouseup", onMouseUp);
    window.removeEventListener("blur", onBlur);
    domElement.removeEventListener("contextmenu", onContext);
    document.removeEventListener("pointerlockchange", onLock);
  };
}
