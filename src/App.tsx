import { GameCanvas } from "./engine/GameCanvas";
import { Hud } from "./ui/Hud";

export function App(): JSX.Element {
  return (
    <div className="app">
      <GameCanvas />
      <Hud />
    </div>
  );
}
