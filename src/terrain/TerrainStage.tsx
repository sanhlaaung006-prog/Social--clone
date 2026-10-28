/*
 * React bridge for the FROZEN ReliefTerrain engine. This file is ours,
 * not locked: it only chooses engine options and lifecycle. All terrain
 * visuals/constants live untouched in src/terrain/locked/.
 *
 * Reproduces the standalone's bootstrap (same field, dimensions,
 * scatter counts/seeds). Man-made structures are intentionally not
 * placed yet — that is a later brick on top of the locked map.
 */

import { useEffect, useRef } from "react";
import { ReliefTerrain } from "./locked/ReliefTerrain";
import { myanmarHeight } from "./locked/noise";
import { sharedRockGeometry, sharedTreeGeometry } from "./locked/structures";

export function TerrainStage(): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const engine = new ReliefTerrain(canvas, wrap, {
      field: myanmarHeight,
      width: 130,
      depth: 210,
      heightScale: 3.4,
      segmentsX: 168,
      segmentsZ: 272,
      waterLevel: 0,
      labelHost: null,
      drift: true
    });
    engine.overview(false);

    // Natural terrain dressing only — same parameters as the approved piece.
    engine.scatter({
      name: "Trees (InstancedMesh)",
      geometry: sharedTreeGeometry,
      count: 1100,
      rules: { minH: 0.35, maxH: 10.2, maxSlope: 1.5, aboveWater: 0.12 },
      size: { r: [0.5, 1.15], h: [2.0, 4.6] },
      tint: { base: "#2f4f37", dh: 0.04, ds: 0.14, dl: 0.12 },
      pivot: 0.43,
      seed: 411
    });
    engine.scatter({
      name: "Rocks (InstancedMesh)",
      geometry: sharedRockGeometry,
      count: 420,
      rules: { minH: 0.2, maxSlope: 4.6, aboveWater: 0.08 },
      size: { r: [0.5, 1.6], h: [0.4, 1.1] },
      tint: { base: "#7f7a6d", dh: 0.02, ds: 0.05, dl: 0.12 },
      pivot: 0.17,
      seed: 977
    });

    engine.start();
    // The locked engine owns its RAF loop and renderer; React never
    // remounts this stage (main.tsx intentionally omits StrictMode).
  }, []);

  return (
    <div ref={wrapRef} className="terrain-wrap">
      <canvas ref={canvasRef} id="terrainCanvas" aria-label="Rotating three-dimensional relief model of Myanmar" />
    </div>
  );
}
