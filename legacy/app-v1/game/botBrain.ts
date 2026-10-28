/*
 * Utility AI brain for battle-royale bots.
 *
 * Combines the sandline-threejs-fps perception lessons (LOS-gated vision,
 * last-seen memory, cover, reaction time — see reference/oss-research.md §7)
 * with a classic utility scorer: every legal action receives a 0..1 utility
 * score from the current world context, and the highest-scoring action runs.
 *
 * Everything here is pure data in, decision out — no THREE objects, no
 * mutation of game state — so the whole decision policy is headless-testable
 * and deterministic. The Bot class (game/actors.ts) owns perception, movement
 * and firing and merely executes the action this selector returns.
 */

export type BotActionId =
  | "engage"
  | "cover"
  | "reload"
  | "search"
  | "returnToZone"
  | "patrol";

/** Immutable world facts assembled once per frame by the Bot. */
export interface BotContext {
  /** Player visible, inside sight range, and ray-clear (no wallhack). */
  hasLOS: boolean;
  /** Horizontal distance to the player. */
  distToPlayer: number;
  /** Bot weapon's effective attack range. */
  attackRange: number;
  /** Current HP fraction, 0..1. */
  hpFrac: number;
  /** Seconds since the last confirmed sighting; Infinity if never seen. */
  memoryAge: number;
  /** How long a last-seen position stays believable. */
  memoryTtl: number;
  /** True beyond the safe-zone margin. */
  outsideZone: boolean;
  /** Metres past the safe-zone boundary (0 while inside). */
  zoneDepth: number;
  /** A validated, occluded cover point was found this decision. */
  coverAvailable: boolean;
  /** Cover retreat is cooling down and must not be re-selected. */
  coverCooldown: boolean;
  /** Magazine fraction, 0..1. */
  magFrac: number;
  /** True while the reload timer is running. */
  reloading: boolean;
  /** Magazine fraction at/below which a safe reload becomes attractive. */
  reloadLowFrac: number;
  /** HP fraction below which retreating to cover becomes attractive. */
  coverHpFrac: number;
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Monotonic 0..1 response curve: 1 - e^(-kx), k controls steepness. */
export function exponentialResponse(x: number, k: number): number {
  return clamp01(1 - Math.exp(-k * Math.max(0, x)));
}

export interface UtilityAction {
  id: BotActionId;
  /** 0 means the action is currently illegal; higher means more urgent. */
  score(ctx: BotContext): number;
}

/**
 * The six warzone behaviours, ordered so that equal scores resolve
 * deterministically (survival actions first, ambient behaviours last).
 */
export function createUtilityActions(): UtilityAction[] {
  return [
    {
      id: "returnToZone",
      score: (c) =>
        c.outsideZone
          ? clamp01(0.75 + c.zoneDepth / 40)
          : 0,
    },
    {
      id: "cover",
      score: (c) => {
        const threatened = c.hasLOS || c.memoryAge < c.memoryTtl;
        const wounded = c.hpFrac < c.coverHpFrac;
        const dry = c.magFrac <= c.reloadLowFrac;
        if (!threatened || !c.coverAvailable || c.coverCooldown) return 0;
        if (!(wounded || c.reloading || dry)) return 0;
        return clamp01(0.6 + (1 - c.hpFrac) * 0.3 + (c.reloading ? 0.15 : 0) + (dry ? 0.1 : 0));
      },
    },
    {
      id: "engage",
      score: (c) => {
        // Reaction time gates the trigger in Bot, not the decision to face
        // the threat — an acquired target is engaged immediately.
        if (!c.hasLOS || c.reloading || c.magFrac <= 0) return 0;
        const closeness = clamp01(1 - c.distToPlayer / c.attackRange);
        return clamp01(0.55 + closeness * 0.3 + c.hpFrac * 0.1);
      },
    },
    {
      id: "reload",
      score: (c) => {
        // While a reload is in flight the action stays committed until the
        // timer completes; a fresh reload is only safe without live contact.
        if (c.reloading) return 0.8;
        if (c.hasLOS || c.magFrac > c.reloadLowFrac) return 0;
        return 0.7;
      },
    },
    {
      id: "search",
      score: (c) => {
        if (c.hasLOS || !(c.memoryAge < c.memoryTtl)) return 0;
        // Fresh memory is urgent; the score decays toward the patrol baseline.
        return 0.15 + 0.5 * (1 - c.memoryAge / c.memoryTtl);
      },
    },
    {
      id: "patrol",
      // Always-legal ambient fallback so the selector never has no action.
      score: () => 0.1,
    },
  ];
}

export interface UtilityDecision {
  id: BotActionId;
  scores: Record<BotActionId, number>;
}

/**
 * Picks the top-scoring action with two anti-flicker guards:
 *  - a score margin: a challenger must beat the incumbent by `margin`;
 *  - a minimum hold time: after `holdTime` the margin shrinks to any
 *    strictly-positive difference.
 * An action whose own score drops to 0 is abandoned immediately.
 */
export class UtilitySelector {
  private current: BotActionId | null = null;
  private holdT = 0;
  readonly scores: Record<BotActionId, number> = {
    engage: 0,
    cover: 0,
    reload: 0,
    search: 0,
    returnToZone: 0,
    patrol: 0,
  };

  constructor(
    private readonly actions: UtilityAction[],
    private readonly margin: number,
    private readonly holdTime: number
  ) {}

  get currentAction(): BotActionId | null {
    return this.current;
  }

  decide(dt: number, ctx: BotContext): UtilityDecision {
    this.holdT += dt;
    for (const a of this.actions) this.scores[a.id] = a.score(ctx);

    let best: BotActionId = this.actions[0].id;
    for (const a of this.actions) {
      if (this.scores[a.id] > this.scores[best]) best = a.id;
    }

    if (this.current === null || this.scores[this.current] <= 0) {
      this.current = best;
      this.holdT = 0;
    } else if (best !== this.current) {
      const incumbent = this.scores[this.current];
      const challenger = this.scores[best];
      const beatsMargin = challenger > incumbent + this.margin;
      const heldLongEnough = this.holdT >= this.holdTime && challenger > incumbent;
      if (beatsMargin || heldLongEnough) {
        this.current = best;
        this.holdT = 0;
      }
    }
    return { id: this.current, scores: { ...this.scores } };
  }

  /** Test/debug seam: force the incumbent (used after hard resets). */
  reset(id: BotActionId = "patrol"): void {
    this.current = id;
    this.holdT = 0;
  }
}
