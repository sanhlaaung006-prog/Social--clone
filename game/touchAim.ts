/*
 * TouchAim — touch look-gesture filter for the right-side look pad.
 *
 * Revised and mixed from the TouchAim technique in the MIT-licensed
 * xilinnihao-afk/sandline-threejs-fps (see reference/oss-research.md §7).
 * This implementation stays in the PIXEL domain: callers feed raw pointer
 * pixel deltas and receive smoothed pixel deltas, so the engine's existing
 * rad/px sensitivity constants (game/actors.ts, vehicle applyLook) remain
 * the single source of turn-rate tuning.
 *
 * Three problems this fixes over raw delta accumulation:
 *  1. Gesture slop — finger placement jitter inside SLOP_PX is swallowed,
 *     and only the excess beyond the slop radius is emitted once broken.
 *  2. Frame-rate-independent smoothing — an exponential low-pass with a
 *     fixed time constant; identical feel at 30/60/120 Hz.
 *  3. Remainder preservation — lifting the finger ends the gesture but the
 *     not-yet-smoothed tail keeps draining, so fast short flicks are never
 *     truncated (clear() is the explicit hard reset for cancelled gestures).
 */

/** Radius (px) of touch jitter ignored at the start of a gesture. */
export const SLOP_PX = 5;
/** Smoothing time constant (seconds). Smaller = snappier, larger = floatier. */
export const SMOOTH_TAU = 0.025;
/** Look gain while aiming down sights (precision mode). */
export const AIM_GAIN = 0.6;
/** dt clamp so a backgrounded tab cannot flush the whole queue in one frame. */
const MAX_DT = 0.1;
/** Sub-pixel residual floor; prevents endless draining of float dust. */
const EPS = 1e-6;

export class TouchAim {
  private pendingX = 0;
  private pendingY = 0;
  private slopX = 0;
  private slopY = 0;
  private slopActive = false;

  /** A new finger touches the look pad. Pending tail from the prior
   *  gesture is intentionally retained (fast flick → lift → re-touch). */
  begin(): void {
    this.slopX = 0;
    this.slopY = 0;
    this.slopActive = false;
  }

  /** Feed a raw pointer movement (pixels). */
  move(dx: number, dy: number): void {
    if (!this.slopActive) {
      this.slopX += dx;
      this.slopY += dy;
      const radius = Math.hypot(this.slopX, this.slopY);
      if (radius <= SLOP_PX) return;
      // Emit only the portion beyond the slop circle, along the gesture axis.
      const excess = (radius - SLOP_PX) / radius;
      this.pendingX += this.slopX * excess;
      this.pendingY += this.slopY * excess;
      this.slopActive = true;
      this.slopX = 0;
      this.slopY = 0;
      return;
    }
    this.pendingX += dx;
    this.pendingY += dy;
  }

  /** Finger lifted: gesture ends, but the smoothed tail keeps draining. */
  end(): void {
    this.begin();
  }

  /** Hard reset (pointercancel / window blur / tab hidden): drop everything. */
  clear(): void {
    this.begin();
    this.pendingX = 0;
    this.pendingY = 0;
  }

  /** Drain one frame's worth of smoothed look delta (pixels).
   *  @param dt      frame seconds
   *  @param gain    1 = normal, AIM_GAIN while aiming down sights */
  pump(dt: number, gain = 1): { dx: number; dy: number } {
    const alpha = 1 - Math.exp(-Math.min(Math.max(dt, 0), MAX_DT) / SMOOTH_TAU);
    const dx = this.pendingX * alpha * gain;
    const dy = this.pendingY * alpha * gain;
    this.pendingX -= dx / gain;
    this.pendingY -= dy / gain;
    if (Math.abs(this.pendingX) < EPS) this.pendingX = 0;
    if (Math.abs(this.pendingY) < EPS) this.pendingY = 0;
    return { dx, dy };
  }

  /** True while smoothed input remains to drain (tests/telemetry). */
  get hasPending(): boolean {
    return this.pendingX !== 0 || this.pendingY !== 0;
  }
}
