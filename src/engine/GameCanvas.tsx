import { useEffect, useRef, useState } from "react";
import { GameEngine, type EngineStats } from "./GameEngine";

export function GameCanvas(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<EngineStats>({ fps: 0, triangles: 0, draws: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new GameEngine(canvas, setStats);
    const onResize = () => engine.resize();
    window.addEventListener("resize", onResize);
    engine.start();
    return () => {
      window.removeEventListener("resize", onResize);
      engine.dispose();
    };
  }, []);

  return (
    <div className="stage">
      <canvas ref={canvasRef} className="game-canvas" aria-label="Golden Land Royale 3D view" />
      <div className="perf-badge" aria-live="polite">
        {stats.fps} FPS · {stats.draws} draws · {(stats.triangles / 1000).toFixed(1)}k tris
      </div>
    </div>
  );
}
