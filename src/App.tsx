import { useEffect, useRef, useState } from "react";
import { Engine } from "@/game/engine";
import type { HudSnapshot } from "@/game/hud";
import HUD from "@/components/HUD";
import TouchControls from "@/components/TouchControls";

const INITIAL_HUD: HudSnapshot = {
  status: "menu",
  hp: 100,
  maxHp: 100,
  mag: 30,
  magSize: 30,
  reserve: 120,
  reloading: false,
  kills: 0,
  alive: 12,
  placement: 12,
  zonePhase: 1,
  zonePhases: 5,
  zoneTimer: 0,
  zoneState: "waiting",
  outsideZone: false,
  hitMarkerAt: 0,
  damageAt: 0,
  killFeed: [],
  wasmReady: false,
  pointerLocked: false,
  player: { x: 0, z: 0, yaw: 0 },
  zone: { x: 0, z: 0, r: 105 },
  blips: [],
  inVehicle: false,
  vehicleKind: null,
  vehicleSeat: null,
  canEnterVehicle: false,
  canSwapSeat: false,
  nearbyVehicleLabel: null,
  gunnerActive: false,
};

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [touch, setTouch] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let poll: ReturnType<typeof setInterval>;

    Engine.create(container).then((engine) => {
      if (disposed) {
        engine.dispose();
        return;
      }
      engineRef.current = engine;
      setTouch(engine.input.touch);
      setReady(true);
      poll = setInterval(() => setHud(engine.getHud()), 100);
    });

    return () => {
      disposed = true;
      clearInterval(poll);
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const deploy = () => engineRef.current?.startMatch();

  return (
    <>
      <div id="game-container" ref={containerRef} />
      {ready && (
        <>
          <HUD hud={hud} touch={touch} onDeploy={deploy} />
          {touch && hud.status === "playing" && (
            <TouchControls input={engineRef.current!.input} hud={hud} />
          )}
        </>
      )}
      <div className="portrait-warning">
        <div>
          🔄 Rotate your device
          <br />
          <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.8 }}>
            Golden Land Royale plays in landscape
          </span>
        </div>
      </div>
    </>
  );
}
