/*
 * AdaptiveResolution — runtime render-scale governor for mobile.
 *
 * Technique revised from the MIT-licensed xilinnihao-afk/sandline-threejs-fps
 * adaptive render-scale loop (see reference/oss-research.md §7): resolution
 * is reduced only after SUSTAINED slow frames, never on a single hitch, with
 * a cooldown between changes so the picture does not oscillate. Our revision
 * adds symmetric, conservative recovery (sustained fast frames buy one step
 * back) and keeps every decision in pure frame-time terms — input/sensitivity
 * is never touched, so aim feel is identical at every scale.
 */

export interface AdaptiveScaleOptions {
  /** Frame rate below which a frame counts as slow. */
  slowFps: number;
  /** Frame rate above which a frame counts toward recovery. */
  fastFps: number;
  /** Consecutive slow seconds required before one downgrade step. */
  sustainSlow: number;
  /** Consecutive fast seconds required before one upgrade step. */
  sustainFast: number;
  /** Quiet period enforced after any scale change. */
  cooldown: number;
  /** Lowest scale permitted. */
  minScale: number;
  /** Scale step applied per downgrade/upgrade. */
  step: number;
}

export class AdaptiveResolution {
  /** Current multiplier applied on top of the tier's pixel-ratio cap. */
  scale = 1;
  private slowT = 0;
  private fastT = 0;
  private cdT = 0;

  constructor(
    private readonly opts: AdaptiveScaleOptions,
    enabled = true
  ) {
    this.disabled = !enabled;
  }

  private readonly disabled: boolean;

  /** False on high-tier devices where the governor never acts. */
  get active(): boolean {
    return !this.disabled;
  }

  /** Feed one frame delta in seconds. Returns true when `scale` changed,
   *  which is the caller's cue to call renderer.setPixelRatio(). */
  sample(dt: number): boolean {
    if (this.disabled || !(dt > 0)) return false;

    this.cdT = Math.max(0, this.cdT - dt);
    const fps = 1 / dt;
    if (fps < this.opts.slowFps) {
      this.slowT += dt;
      this.fastT = 0;
    } else if (fps > this.opts.fastFps) {
      this.fastT += dt;
      this.slowT = 0;
    } else {
      // Comfortable mid-range: hold the current scale.
      this.slowT = 0;
      this.fastT = 0;
    }

    if (this.cdT > 0) return false;

    if (this.slowT >= this.opts.sustainSlow && this.scale > this.opts.minScale) {
      this.scale = Math.max(this.opts.minScale, this.scale - this.opts.step);
      this.slowT = 0;
      this.cdT = this.opts.cooldown;
      return true;
    }
    if (this.fastT >= this.opts.sustainFast && this.scale < 1) {
      this.scale = Math.min(1, this.scale + this.opts.step);
      this.fastT = 0;
      this.cdT = this.opts.cooldown;
      return true;
    }
    return false;
  }
}
