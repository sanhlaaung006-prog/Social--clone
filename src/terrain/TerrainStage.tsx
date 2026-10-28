/*
 * React bridge for the FROZEN ReliefTerrain engine. This file is ours,
 * not locked: it chooses engine options and layers the first-person
 * controller on top. The locked modules stay byte-identical.
 *
 * Two modes share one engine: "orbit" runs the locked drift camera;
 * "walk" hands the camera to the immersive FP controller and moves the
 * shadow sun with the player. The 5 km merged field (value + simplex
 * noise) feeds the locked engine through its public field option.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ReliefTerrain } from "./locked/ReliefTerrain";
import {
  findSpawn,
  groundHeight,
  HEIGHT_SCALE,
  MAP_SEGMENTS,
  MAP_SIZE,
  mergedField
} from "./myanmarMap";
import { sharedRockGeometry, sharedTreeGeometry } from "./locked/structures";
import { createFpState, stepFp, type FpState } from "../player/controller";
import { FirstPersonRig } from "../player/FirstPersonRig";
import { InputBus } from "../player/input";
import { TouchControls } from "../ui/TouchControls";

type Mode = "orbit" | "walk";

export function TerrainStage(): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coordRef = useRef<HTMLDivElement>(null);
  const busRef = useRef<InputBus | null>(null);
  const engineRef = useRef<ReliefTerrain | null>(null);
  const [mode, setMode] = useState<Mode>("orbit");
  const modeRef = useRef<Mode>("orbit");
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const engine = new ReliefTerrain(canvas, wrap, {
      field: mergedField,
      width: MAP_SIZE,
      depth: MAP_SIZE,
      heightScale: HEIGHT_SCALE,
      segmentsX: MAP_SEGMENTS,
      segmentsZ: MAP_SEGMENTS,
      waterLevel: 0,
      labelHost: null,
      drift: true
    });

    // 5 km visibility: widen fog and far plane (runtime instances only;
    // the locked engine file itself is never modified).
    engine.scene.fog = new THREE.Fog(0x0c1510, 240, 1800);
    engine.camera.far = 6000;
    engine.camera.updateProjectionMatrix();
    engine.overview(false);

    // Natural dressing retuned for the 5 km scale (world-metre rules).
    engine.scatter({
      name: "Trees (InstancedMesh)",
      geometry: sharedTreeGeometry,
      count: 2600,
      rules: { minH: 3, maxH: 95, maxSlope: 1.6, aboveWater: 1.5 },
      size: { r: [0.8, 2.2], h: [3.5, 8] },
      tint: { base: "#2f4f37", dh: 0.04, ds: 0.14, dl: 0.12 },
      pivot: 0.43,
      seed: 411
    });
    engine.scatter({
      name: "Rocks (InstancedMesh)",
      geometry: sharedRockGeometry,
      count: 850,
      rules: { minH: 1, maxSlope: 5, aboveWater: 0.5 },
      size: { r: [0.6, 2.4], h: [0.5, 1.6] },
      tint: { base: "#7f7a6d", dh: 0.02, ds: 0.05, dl: 0.12 },
      pivot: 0.17,
      seed: 977
    });

    // Locate the shadow-casting sun for player-relative shadows.
    let sun: THREE.DirectionalLight | null = null;
    engine.scene.traverse((o) => {
      if (o instanceof THREE.DirectionalLight && o.castShadow) sun = o;
    });

    const bus = new InputBus(canvas);
    busRef.current = bus;
    engineRef.current = engine;
    setIsTouch(bus.isTouchDevice());
    const rig = new FirstPersonRig(engine.camera);
    const spawn = findSpawn();
    let fp: FpState = createFpState(spawn.x, spawn.y, spawn.z, 0);
    const frameClock = new THREE.Clock();

    engine.start(() => {
      if (modeRef.current !== "walk") return;
      const dt = Math.min(0.05, frameClock.getDelta());
      const input = bus.sample();
      stepFp(fp, input, dt, groundHeight);
      rig.apply(fp);
      if (sun) {
        sun.position.set(fp.x - 150, fp.y + 220, fp.z + 120);
        sun.target.position.set(fp.x, fp.y, fp.z);
        sun.target.updateMatrixWorld();
      }
      if (coordRef.current) {
        coordRef.current.textContent =
          `x ${fp.x.toFixed(0)} m · z ${fp.z.toFixed(0)} m · alt ${fp.y.toFixed(1)} m` +
          (fp.wading ? " · wading" : "");
      }
    });

    return () => {
      bus.dispose();
    };
  }, []);

  const enterWalk = () => {
    modeRef.current = "walk";
    setMode("walk");
    const bus = busRef.current;
    const engine = engineRef.current;
    if (bus) bus.active = true;
    if (engine) {
      engine.controls.enabled = false;
      engine.setDrift(false);
    }
  };

  const exitWalk = () => {
    modeRef.current = "orbit";
    setMode("orbit");
    const bus = busRef.current;
    const engine = engineRef.current;
    if (bus) {
      bus.active = false;
      bus.exitPointerLock();
      bus.setJoystick(0, 0);
      bus.setSprint(false);
      bus.setCrouch(false);
    }
    if (engine) {
      engine.controls.enabled = true;
      engine.setDrift(true);
      engine.overview(true);
    }
  };

  return (
    <div ref={wrapRef} className="terrain-wrap">
      <canvas ref={canvasRef} id="terrainCanvas" aria-label="First-person walkable relief map of Myanmar" />
      {mode === "walk" && (
        <>
          {isTouch && busRef.current && <TouchControls bus={busRef.current} />}
          <div className="crosshair" aria-hidden="true" />
          <div ref={coordRef} className="coord-readout" />
          <button className="mode-btn mode-btn-exit" onClick={exitWalk}>
            ← orbit view
          </button>
          {!isTouch && <div className="walk-hint">WASD move · mouse look · Shift run · C crouch · Space jump · Q/E lean · Esc release</div>}
        </>
      )}
      {mode === "orbit" && (
        <button className="mode-btn mode-btn-enter" onClick={enterWalk}>
          ▶ walk the map
        </button>
      )}
    </div>
  );
}
