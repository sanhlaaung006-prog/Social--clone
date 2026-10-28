/*
 * Unified input bus: keyboard + pointer-lock mouse on desktop, virtual
 * joystick / drag-look / buttons from the React touch layer on mobile.
 * Produces one FpState-ready FpInput per frame and consumes look deltas
 * on read so impulses never queue up.
 */

import type { FpInput } from "./controller";

const LOOK_PIXEL_TO_RAD = 0.0022;

export class InputBus {
  private readonly keys = new Set<string>();
  private lookDX = 0;
  private lookDY = 0;
  private touchMoveX = 0;
  private touchMoveZ = 0;
  private touchSprint = false;
  private touchCrouch = false;
  private touchLean = 0;
  private jumpQueued = false;
  private pointerLocked = false;
  private readonly target: HTMLElement;
  private detachFns: Array<() => void> = [];
  /** Touch look sensitivity multiplier, tuned by the touch layer. */
  lookScale = 1;
  /** When false (orbit mode) the bus ignores pointer-lock requests. */
  active = false;

  constructor(target: HTMLElement) {
    this.target = target;
    const onKeyDown = (e: KeyboardEvent) => {
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.code === "Space") this.jumpQueued = true;
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    const onMouseMove = (e: MouseEvent) => {
      if (!this.pointerLocked) return;
      this.lookDX += e.movementX * LOOK_PIXEL_TO_RAD;
      this.lookDY += e.movementY * LOOK_PIXEL_TO_RAD;
    };
    const onLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.target;
      if (!this.pointerLocked) this.keys.clear();
    };
    const onCanvasClick = () => {
      if (this.active && !this.isTouchDevice() && document.pointerLockElement !== this.target) {
        this.target.requestPointerLock?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointerlockchange", onLockChange);
    this.target.addEventListener("click", onCanvasClick);
    this.detachFns.push(
      () => window.removeEventListener("keydown", onKeyDown),
      () => window.removeEventListener("keyup", onKeyUp),
      () => window.removeEventListener("mousemove", onMouseMove),
      () => document.removeEventListener("pointerlockchange", onLockChange),
      () => this.target.removeEventListener("click", onCanvasClick)
    );
  }

  get isLocked(): boolean {
    return this.pointerLocked;
  }

  isTouchDevice(): boolean {
    return window.matchMedia?.("(pointer: coarse)").matches ?? "ontouchstart" in window;
  }

  /* ---------------------------- touch API ----------------------------- */
  setJoystick(x: number, z: number): void {
    this.touchMoveX = Math.max(-1, Math.min(1, x));
    this.touchMoveZ = Math.max(-1, Math.min(1, z));
  }

  addTouchLook(dxPixels: number, dyPixels: number): void {
    this.lookDX += dxPixels * LOOK_PIXEL_TO_RAD * this.lookScale;
    this.lookDY += dyPixels * LOOK_PIXEL_TO_RAD * this.lookScale;
  }

  setSprint(active: boolean): void {
    this.touchSprint = active;
  }

  setCrouch(active: boolean): void {
    this.touchCrouch = active;
  }

  setLean(value: number): void {
    this.touchLean = Math.max(-1, Math.min(1, value));
  }

  queueJump(): void {
    this.jumpQueued = true;
  }

  exitPointerLock(): void {
    document.exitPointerLock?.();
  }

  /* ----------------------------- per frame ---------------------------- */
  sample(): FpInput {
    const k = this.keys;
    const keyX = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const keyZ = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const keyboardLean = (k.has("KeyE") ? 1 : 0) - (k.has("KeyQ") ? 1 : 0);

    const input: FpInput = {
      moveX: Math.abs(this.touchMoveX) > Math.abs(keyX) ? this.touchMoveX : keyX,
      moveZ: Math.abs(this.touchMoveZ) > Math.abs(keyZ) ? this.touchMoveZ : keyZ,
      lookDX: this.lookDX,
      lookDY: this.lookDY,
      sprint: this.touchSprint || k.has("ShiftLeft") || k.has("ShiftRight"),
      crouch: this.touchCrouch || k.has("ControlLeft") || k.has("KeyC"),
      jump: this.jumpQueued,
      lean: this.touchLean || keyboardLean
    };
    this.lookDX = 0;
    this.lookDY = 0;
    this.jumpQueued = false;
    return input;
  }

  dispose(): void {
    this.detachFns.forEach((fn) => fn());
    this.detachFns = [];
  }
}
