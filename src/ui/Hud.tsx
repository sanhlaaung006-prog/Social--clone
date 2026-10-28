/**
 * Minimal React HUD overlay for the locked terrain milestone.
 * Gameplay HUD returns in later bricks; terrain code stays untouched.
 */
export function Hud(): JSX.Element {
  return (
    <div className="hud" aria-hidden="true">
      <div className="hud-panel hud-title">
        <div className="hud-eyebrow">GOLDEN LAND ROYALE</div>
        <div className="hud-sub">Myanmar relief · locked art foundation · 5 × 5 km merged-noise map</div>
      </div>
      <div className="hud-panel hud-hint">
        value + simplex noise · drift orbit · tap walk to enter first person
      </div>
    </div>
  );
}
