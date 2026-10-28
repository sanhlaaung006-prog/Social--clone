import { TerrainStage } from "./terrain/TerrainStage";
import { Hud } from "./ui/Hud";

export function App(): JSX.Element {
  return (
    <div className="app">
      <TerrainStage />
      <Hud />
    </div>
  );
}
