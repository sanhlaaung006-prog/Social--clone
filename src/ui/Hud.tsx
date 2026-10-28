/**
 * Minimal React HUD overlay for the locked terrain milestone.
 * Gameplay HUD returns in later bricks; terrain code stays untouched.
 */
export function Hud(): JSX.Element {
  return (
    <div className="hud" aria-hidden="true">
      <div className="hud-panel hud-title">
        <div className="hud-eyebrow">GOLDEN LAND ROYALE</div>
        <div className="hud-sub">Myanmar relief · locked terrain foundation</div>
      </div>
      <div className="hud-panel hud-hint">
        one continuous height field · 130 × 210 m · sea level 0 · drift orbit
      </div>
    </div>
  );
}
