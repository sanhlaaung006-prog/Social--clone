/*
 * Stylized A-10C "Warthog" — procedural, anti-voxel airframe built only
 * from curved primitives and superellipse lofts (no BoxGeometry).
 *
 * The silhouette follows the reference factory's part registry
 * (reference/warthog-factory, MIT-compatible technique port in
 * game/geometry/kit.ts): long straight fuselage, belly GAU-8 fairing and
 * nose barrel, bubble canopy, broad near-straight wings with twin high
 * engine nacelles, twin tails, tricycle gear. Re-authored at game scale
 * with the shared flat-shaded vehicle material family.
 */

import * as THREE from "three";
import { loft } from "../geometry/kit";
import {
  createVehicleMaterials,
  taperedSlabGeometry,
  type VehicleMaterials,
} from "./stylized";

function mesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name?: string
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  if (name) m.name = name;
  parent.add(m);
  return m;
}

/** Cylinder whose axis runs along Z (forward), like the stylized jet's barrels. */
function zCylinder(
  radiusTop: number,
  radiusBottom: number,
  length: number,
  segments = 10
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, segments, 1);
  geo.rotateX(Math.PI / 2);
  return geo;
}

export function buildWarthog(): THREE.Group {
  const mats: VehicleMaterials = createVehicleMaterials();
  const root = new THREE.Group();
  root.name = "A-10 Warthog";

  /* ------------------------------- fuselage ------------------------------ */
  mesh(
    root,
    loft(
      [
        { z: 5.6, w: 0.28, h: 0.26, y: -0.12 },
        { z: 5.0, w: 0.46, h: 0.42, y: -0.12 },
        { z: 4.2, w: 0.62, h: 0.58, y: -0.08 },
        { z: 3.0, w: 0.78, h: 0.74, y: 0 },
        { z: 1.4, w: 0.86, h: 0.82, y: 0.02 },
        { z: 0, w: 0.88, h: 0.84, y: 0.02 },
        { z: -1.6, w: 0.82, h: 0.76, y: 0.06 },
        { z: -3.2, w: 0.66, h: 0.6, y: 0.12 },
        { z: -4.6, w: 0.42, h: 0.38, y: 0.2 },
        { z: -5.2, w: 0.16, h: 0.15, y: 0.24 },
      ],
      16
    ),
    mats.chassis,
    "fuselage"
  );

  // Rounded radome cap on the nose.
  const radome = mesh(
    root,
    new THREE.SphereGeometry(0.3, 12, 9),
    mats.darkMetal,
    "radome"
  );
  radome.scale.set(0.95, 0.9, 1.25);
  radome.position.set(0, -0.12, 5.72);

  /* ----------------------------- GAU-8/A Avenger -------------------------- */
  // The A-10's identity: the big rotary cannon poking from the nose.
  mesh(root, zCylinder(0.075, 0.09, 1.05, 10), mats.darkMetal, "gau8-barrel");
  root.getObjectByName("gau8-barrel")!.position.set(0, -0.24, 6.1);
  const muzzle = mesh(
    root,
    new THREE.TorusGeometry(0.095, 0.028, 8, 14),
    mats.darkMetal,
    "gau8-muzzle-ring"
  );
  muzzle.position.set(0, -0.24, 6.63);
  // Belly gun fairing under the forward fuselage.
  mesh(
    root,
    loft(
      [
        { z: 4.6, w: 0.24, h: 0.1, y: -0.72, e: 3 },
        { z: 3.4, w: 0.34, h: 0.22, y: -0.78, e: 3 },
        { z: 1.8, w: 0.3, h: 0.16, y: -0.82, e: 3 },
      ],
      12
    ),
    mats.darkMetal,
    "gun-fairing"
  );

  /* -------------------------------- canopy -------------------------------- */
  const canopy = mesh(
    root,
    new THREE.SphereGeometry(0.46, 12, 9),
    mats.glass,
    "canopy"
  );
  canopy.scale.set(0.85, 0.62, 1.5);
  canopy.position.set(0, 0.62, 3.7);

  /* --------------------------------- wings -------------------------------- */
  // Broad, near-straight planform (low sweep, moderate taper): the A-10's
  // signature straight wing, built as vertex-manipulated slabs, never boxes.
  for (const side of [-1, 1]) {
    const wing = mesh(
      root,
      taperedSlabGeometry({
        width: 6.2,
        height: 0.16,
        depth: 2.3,
        taper: 0.5,
        sweep: 0.35,
      }),
      mats.camo,
      side < 0 ? "main-wing-port" : "main-wing-starboard"
    );
    wing.position.set(side * 3.1, -0.08, 0.4);
    wing.rotation.z = side * 0.05; // gentle dihedral

    // Outer pylon pod (rounded tube, not a box store).
    const pod = mesh(
      root,
      zCylinder(0.16, 0.16, 1.5, 10),
      mats.darkMetal,
      side < 0 ? "pylon-pod-port" : "pylon-pod-starboard"
    );
    pod.position.set(side * 4.4, -0.32, 0.35);
    const podNose = mesh(
      root,
      new THREE.ConeGeometry(0.16, 0.45, 10),
      mats.darkMetal
    );
    podNose.geometry.rotateX(Math.PI / 2);
    podNose.position.set(side * 4.4, -0.32, 1.32);
  }

  /* --------------------------- twin engine nacelles ----------------------- */
  // High-mounted TF34 pods above the wing roots, flanking the rear fuselage.
  for (const side of [-1, 1]) {
    const nacelle = mesh(
      root,
      zCylinder(0.42, 0.46, 2.7, 14),
      mats.chassis,
      side < 0 ? "engine-nacelle-port" : "engine-nacelle-starboard"
    );
    nacelle.scale.set(1, 1, 1);
    nacelle.position.set(side * 1.05, 0.85, -2.1);

    // Intake lip and dark fan face.
    const intake = mesh(
      root,
      new THREE.TorusGeometry(0.42, 0.07, 8, 16),
      mats.darkMetal
    );
    intake.position.set(side * 1.05, 0.85, -0.72);
    const fan = mesh(
      root,
      new THREE.CylinderGeometry(0.34, 0.34, 0.08, 14),
      mats.rubber
    );
    fan.geometry.rotateX(Math.PI / 2);
    fan.position.set(side * 1.05, 0.85, -0.7);

    // Exhaust nozzle: tapered cone + ring at the tail.
    const nozzle = mesh(
      root,
      new THREE.ConeGeometry(0.4, 0.7, 14),
      mats.darkMetal
    );
    nozzle.geometry.rotateX(-Math.PI / 2);
    nozzle.position.set(side * 1.05, 0.85, -3.75);
    const exhaust = mesh(
      root,
      new THREE.TorusGeometry(0.26, 0.06, 8, 14),
      mats.rubber
    );
    exhaust.position.set(side * 1.05, 0.85, -4.1);
  }

  /* -------------------------------- empennage ----------------------------- */
  // Horizontal stabilizers and the distinctive twin outboard vertical fins.
  for (const side of [-1, 1]) {
    const stab = mesh(
      root,
      taperedSlabGeometry({
        width: 1.7,
        height: 0.12,
        depth: 1.2,
        taper: 0.55,
        sweep: 0.3,
      }),
      mats.camo
    );
    stab.position.set(side * 0.95, 0.28, -4.6);

    const fin = mesh(
      root,
      taperedSlabGeometry({
        width: 0.14,
        height: 1.35,
        depth: 1.5,
        taper: 0.5,
        sweep: 0.4,
      }),
      mats.chassis,
      side < 0 ? "tail-fin-port" : "tail-fin-starboard"
    );
    fin.position.set(side * 1.5, 1.0, -4.7);
    fin.rotation.z = side * 0.12;
  }

  /* ------------------------------ landing gear ----------------------------- */
  // Tricycle arrangement: two mains under the wings and a nose leg.
  const legGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.8, 7);
  for (const [x, z] of [
    [-1.25, -0.6],
    [1.25, -0.6],
    [0, 2.4],
  ] as Array<[number, number]>) {
    const leg = mesh(root, legGeo, mats.darkMetal, "gear-strut");
    leg.position.set(x, -0.5, z);
    const wheelGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.13, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheel = mesh(root, wheelGeo, mats.rubber, "gear-wheel");
    wheel.position.set(x, -0.87, z);
  }

  return root;
}
