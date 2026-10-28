/**
 * Minimal React HUD overlay for the visual-rebuild milestone.
 * Gameplay HUD elements (crosshair, health, touch controls) return as
 * their respective modules are ported from the v1 build.
 */
export function Hud(): JSX.Element {
  return (
    <div className="hud" aria-hidden="true">
      <div className="hud-panel hud-title">
        <div className="hud-eyebrow">GOLDEN LAND ROYALE</div>
        <div className="hud-sub">renderer rebuild · milestone 1 · visual baseline</div>
      </div>
      <div className="hud-panel hud-hint">
        procedural materials · ACES tone mapping · soft shadows · IBL
      </div>
    </div>
  );
}
