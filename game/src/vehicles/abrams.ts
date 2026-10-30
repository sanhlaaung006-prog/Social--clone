/**
 * ABRAMS TANK FACTORY
 * ------------------------------------------------------------------
 * A clean, fully procedural M1A2 Abrams reference model.
 * Three.js only. No external meshes, textures, fonts or images.
 *
 * Axes: +Z forward, +X starboard, +Y up. Units: metres.
 * Reuse: const tank = createAbramsAssembly(); scene.add(tank.root);
 *
 * Every assembly is grouped and registered so it can be highlighted,
 * inspected, isolated, exploded and exported. Animation is driven by
 * tank.update(dt); turret traverse, gun elevation, track motion and
 * the firing sequence are all procedural.
 */

import * as THREE from "three";

export type LiveryId = "olive" | "desert" | "forest" | "urban";
export type ArmorId = "clean" | "combat" | "heavy";
export type PartCategory =
  | "Hull"
  | "Turret"
  | "Armament"
  | "Mobility"
  | "Power"
  | "Armour"
  | "Systems"
  | "Stowage";

export interface PartSpec {
  id: string;
  code: string;
  name: string;
  category: PartCategory;
  summary: string;
  material: string;
  massKg: number;
  /** length (Z), width (X), height (Y) in metres */
  dimensions: [number, number, number];
  note: string;
}

export const TANK_SPECS = {
  designation: "M1A2 SEPv3 Abrams",
  nickname: "Abrams",
  role: "Main battle tank",
  origin: "United States",
  crew: "4 — commander, gunner, loader, driver",
  lengthGunForwardM: 9.77,
  hullLengthM: 7.93,
  widthM: 3.66,
  heightM: 2.44,
  weightKg: 73600,
  combatWeightKg: 73900,
  engine: "Honeywell AGT1500 gas turbine",
  powerHp: 1500,
  transmission: "Allison X-1100 hydrokinetic",
  maxSpeedKmh: 67,
  rangeKm: 426,
  gun: "M256 120 mm smoothbore",
  ammoRounds: 42,
  coax: "M240 7.62 mm",
  secondary: "M2HB 12.7 mm",
  armor: "Composite / depleted uranium mesh",
  firstDelivered: 1980,
  unitsBuilt: "approx. 10,000+",
};

export const PART_SPECS: PartSpec[] = [
  {
    id: "hull",
    code: "A-01",
    name: "Hull",
    category: "Hull",
    summary:
      "Welded steel hull with a long glacis, protected crew compartment and rear engine bay frame.",
    material: "Rolled homogeneous armour",
    massKg: 21400,
    dimensions: [7.93, 3.66, 1.25],
    note: "The driver sits low in the front centre, with the turret basket and fighting compartment behind.",
  },
  {
    id: "turret",
    code: "A-02",
    name: "Turret",
    category: "Turret",
    summary:
      "Angular, flat-sided turret carrying the main gun, autoloader-ready bustle and crew hatches.",
    material: "Composite armour / steel",
    massKg: 16200,
    dimensions: [3.55, 3.66, 1.6],
    note: "The turret rotates through a full 360° in under 10 seconds. This model animates traverse and elevation live.",
  },
  {
    id: "cannon",
    code: "A-03",
    name: "M256 cannon",
    category: "Armament",
    summary:
      "120 mm smoothbore main gun with thermal sleeve, recoil system and remotely controlled stabilisation.",
    material: "Gun steel / thermal shroud",
    massKg: 1900,
    dimensions: [5.3, 0.42, 0.42],
    note: "The M256 fires APFSDS and high-explosive rounds. Recoil is modelled as a damped return stroke; use the FIRE control to cycle it.",
  },
  {
    id: "running-gear",
    code: "A-04",
    name: "Running gear",
    category: "Mobility",
    summary:
      "Twin track runs, seven road wheels per side, torsion-bar suspension, idlers and drive sprockets.",
    material: "Steel / rubber track pads",
    massKg: 12400,
    dimensions: [7.3, 3.72, 1.3],
    note: "Wide 635 mm tracks keep ground pressure low. The wheels and sprockets spin whenever drive animation is engaged.",
  },
  {
    id: "powerpack",
    code: "A-05",
    name: "AGT1500 powerpack",
    category: "Power",
    summary:
      "Gas turbine, transmission and cooling pack in a single rear module beneath the engine deck.",
    material: "Titanium / steel / heat shielding",
    massKg: 4100,
    dimensions: [2.9, 2.4, 1.25],
    note: "The 1,500 hp turbine gives the Abrams a distinctive whine. It can run on diesel, jet fuel or marine diesel.",
  },
  {
    id: "armour",
    code: "A-06",
    name: "Armour package",
    category: "Armour",
    summary:
      "Base skirts and sponson plates. Select a heavier package in the workshop to add ERA tiles and APS panels.",
    material: "Composite / explosive reactive armour",
    massKg: 8600,
    dimensions: [6.4, 3.72, 1.1],
    note: "The TUSK package adds side ERA, a reinforced belly and additional protection for the crew and optics.",
  },
  {
    id: "optics",
    code: "A-07",
    name: "Optics & sensors",
    category: "Systems",
    summary:
      "Gunner's primary sight, commander's independent thermal viewer, lenses and wind sensor.",
    material: "Armoured glass / electronics",
    massKg: 420,
    dimensions: [1.1, 2.2, 0.8],
    note: "The panoramic CITV lets the commander search for targets independently of the gunner's sight.",
  },
  {
    id: "crew",
    code: "A-08",
    name: "Crew stations",
    category: "Systems",
    summary:
      "Commander's cupola, loader's hatch, driver's hatch, machine guns and periscope set.",
    material: "Steel / armoured glass",
    massKg: 1200,
    dimensions: [2.8, 2.4, 0.9],
    note: "Four crew members operate inside. The commander and loader can each mount a machine gun on the roof.",
  },
  {
    id: "stowage",
    code: "A-09",
    name: "Bustle stowage",
    category: "Stowage",
    summary:
      "Rear turret rack with crew equipment, spares and the turret's external tool boxes.",
    material: "Aluminium rack / canvas bags",
    massKg: 540,
    dimensions: [1.1, 3.0, 0.8],
    note: "The rear rack offsets the mass of the gun forward. Stowage changes with the selected mission package.",
  },
  {
    id: "defensive",
    code: "A-09",
    name: "Defensive suite",
    category: "Armour",
    summary:
      "Smoke dischargers, antennas, Trophy radar panels and the rearwarning sensor fit.",
    material: "Steel / composite electronics",
    massKg: 760,
    dimensions: [2.2, 3.9, 1.1],
    note: "Trophy intercepts incoming anti-tank missiles. Radar panels appear when the Heavy package is selected.",
  },
];

export const LIVERY_PRESETS: Array<{
  id: LiveryId;
  label: string;
  swatch: string;
  body: string;
  panel: string;
  accent: string;
  dark: string;
}> = [
  {
    id: "olive",
    label: "Olive drab",
    swatch: "#606852",
    body: "#666e55",
    panel: "#525a45",
    accent: "#d7e074",
    dark: "#2c3228",
  },
  {
    id: "desert",
    label: "Desert sand",
    swatch: "#ac9976",
    body: "#aa9673",
    panel: "#918060",
    accent: "#e0b95f",
    dark: "#4a4537",
  },
  {
    id: "forest",
    label: "Forest",
    swatch: "#4d5d42",
    body: "#526044",
    panel: "#404e37",
    accent: "#c2d276",
    dark: "#252f23",
  },
  {
    id: "urban",
    label: "Urban grey",
    swatch: "#7c827f",
    body: "#7b827d",
    panel: "#666d69",
    accent: "#cbd67f",
    dark: "#363c3a",
  },
];

export const ARMOR_PACKAGES: Array<{
  id: ArmorId;
  label: string;
  count: number;
  massKg: number;
}> = [
  { id: "clean", label: "Base", count: 0, massKg: 0 },
  { id: "combat", label: "TUSK", count: 10, massKg: 860 },
  { id: "heavy", label: "Heavy", count: 18, massKg: 2100 },
];

interface Materials {
  body: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  lens: THREE.MeshPhysicalMaterial;
  glass: THREE.MeshPhysicalMaterial;
}

interface PartRecord {
  spec: PartSpec;
  group: THREE.Group;
  base: THREE.Vector3;
  explode: THREE.Vector3;
  materials: Set<THREE.Material>;
}

interface SmokePuff {
  mesh: THREE.Mesh;
  life: number;
  age: number;
  velocity: THREE.Vector3;
}

export interface TankAssembly {
  root: THREE.Group;
  parts: Map<string, PartRecord>;
  partSpecs: PartSpec[];
  setLivery: (id: LiveryId) => void;
  setArmor: (id: ArmorId) => void;
  setExplode: (amount: number) => void;
  setBlueprint: (enabled: boolean) => void;
  setHighlight: (id: string | null, strength: number) => void;
  setSolo: (id: string | null) => void;
  setTurret: (degrees: number) => void;
  setGun: (degrees: number) => void;
  setScan: (enabled: boolean) => void;
  setDrive: (enabled: boolean) => void;
  /** Game extension: signed ground speed (m/s) driving wheel spin/exhaust. */
  setDriveSpeed: (metresPerSecond: number) => void;
  /** Game extension: live rig nodes for muzzle/turret world transforms. */
  rig: {
    turretPivot: THREE.Object3D;
    gunPivot: THREE.Object3D;
    gunBarrel: THREE.Object3D;
    muzzle: THREE.Object3D;
  };
  fire: () => void;
  update: (dt: number) => void;
  getRig: () => { turret: number; gun: number };
  getStats: () => { parts: number; meshes: number; triangles: number; materials: number };
  dispose: () => void;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;

function addBox(
  parent: THREE.Object3D,
  material: THREE.Material,
  size: [number, number, number],
  position: [number, number, number],
  rotation?: [number, number, number]
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
}

function addCylinder(
  parent: THREE.Object3D,
  material: THREE.Material,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  position: [number, number, number],
  axis: "x" | "y" | "z" = "y",
  segments = 18
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material
  );
  if (axis === "x") mesh.rotation.z = Math.PI / 2;
  if (axis === "z") mesh.rotation.x = Math.PI / 2;
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function addWheel(
  parent: THREE.Object3D,
  tyre: THREE.Material,
  hub: THREE.Material,
  x: number,
  y: number,
  z: number,
  radius: number,
  width: number
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  parent.add(group);

  const tyreGeometry = new THREE.CylinderGeometry(radius, radius, width, 26);
  tyreGeometry.rotateZ(Math.PI / 2);
  const tyreMesh = new THREE.Mesh(tyreGeometry, tyre);
  group.add(tyreMesh);

  const hubGeometry = new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, width * 1.04, 20);
  hubGeometry.rotateZ(Math.PI / 2);
  const hubMesh = new THREE.Mesh(hubGeometry, hub);
  group.add(hubMesh);

  for (let i = 0; i < 8; i += 1) {
    const bolt = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.055, 0.045),
      hub
    );
    const angle = (i / 8) * TAU;
    bolt.position.set(width * 0.54, Math.sin(angle) * radius * 0.4, Math.cos(angle) * radius * 0.4);
    group.add(bolt);
  }
  return group;
}

function makeTrackGeometry(width: number, length: number, height: number): THREE.BufferGeometry {
  const radius = height / 2;
  const half = length / 2 - radius;
  const band = 0.13;

  const capsule = (r: number) => {
    const path = new THREE.Shape();
    path.moveTo(-half, -r);
    path.lineTo(half, -r);
    path.absarc(half, 0, r, -Math.PI / 2, Math.PI / 2, false);
    path.lineTo(-half, r);
    path.absarc(-half, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
    return path;
  };

  const shape = capsule(radius);
  const inner = capsule(radius - band);
  shape.holes.push(new THREE.Path(inner.getPoints(48)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.03,
    bevelThickness: 0.03,
    steps: 1,
    curveSegments: 16,
  });
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(width / 2, 0, 0);
  geometry.computeVertexNormals();
  return geometry;
}

function makeDecalTexture(title: string, subtitle: string, star = false): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, 512, 180);
    ctx.fillStyle = "rgba(34, 38, 30, 0.78)";
    ctx.font = "700 67px 'Arial Narrow', Arial, sans-serif";
    ctx.fillText(title, 18, 82);
    ctx.font = "600 25px monospace";
    ctx.letterSpacing = "6px";
    ctx.fillText(subtitle, 22, 130);
    ctx.fillStyle = "rgba(213, 226, 130, 0.85)";
    ctx.fillRect(20, 100, 130, 5);
    if (star) {
      ctx.save();
      ctx.translate(430, 88);
      ctx.fillStyle = "rgba(46, 52, 40, 0.8)";
      ctx.beginPath();
      ctx.arc(0, 0, 56, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(236, 236, 213, 0.85)";
      ctx.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const r = i % 2 === 0 ? 44 : 18;
        const angle = -Math.PI / 2 + (i / 10) * TAU;
        if (i === 0) ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
        else ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(56, 12, 20, 8);
      ctx.fillRect(-76, 12, 20, 8);
      ctx.restore();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/* ------------------------------------------------------------------ */
/* assembly                                                            */
/* ------------------------------------------------------------------ */

export function createAbramsAssembly(
  initialLivery: LiveryId = "olive",
  initialArmor: ArmorId = "combat"
): TankAssembly {
  const root = new THREE.Group();
  root.name = "M1A2_Abrams";
  const parts = new Map<string, PartRecord>();
  const allMeshes: THREE.Mesh[] = [];
  const edgeLines: THREE.LineSegments[] = [];
  const allMaterials = new Set<THREE.Material>();
  const liveryMaterials: Record<"body" | "panel" | "dark" | "accent", Set<THREE.MeshStandardMaterial>> = {
    body: new Set(),
    panel: new Set(),
    dark: new Set(),
    accent: new Set(),
  };
  const specMap = new Map(PART_SPECS.map((spec) => [spec.id, spec]));
  let palette = LIVERY_PRESETS.find((item) => item.id === initialLivery) ?? LIVERY_PRESETS[0];
  let exploded = 0;
  let blueprint = false;
  let armorPackage: ArmorId = initialArmor;

  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0xd8e58c,
    transparent: true,
    opacity: 0.66,
  });

  const makeMaterials = (): Materials => {
    const body = new THREE.MeshStandardMaterial({
      color: palette.body,
      metalness: 0.22,
      roughness: 0.74,
      envMapIntensity: 0.55,
    });
    const panel = new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.panel).multiplyScalar(0.93),
      metalness: 0.28,
      roughness: 0.69,
      envMapIntensity: 0.55,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: palette.dark,
      metalness: 0.4,
      roughness: 0.58,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: 0x8f9488,
      metalness: 0.84,
      roughness: 0.35,
    });
    const rubber = new THREE.MeshStandardMaterial({
      color: 0x1c201a,
      metalness: 0.15,
      roughness: 0.88,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: palette.accent,
      metalness: 0.18,
      roughness: 0.56,
    });
    const lens = new THREE.MeshPhysicalMaterial({
      color: 0x1f3830,
      metalness: 0.45,
      roughness: 0.08,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.25,
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x39453d,
      metalness: 0.4,
      roughness: 0.12,
      transparent: true,
      opacity: 0.6,
      envMapIntensity: 1,
    });
    liveryMaterials.body.add(body);
    liveryMaterials.panel.add(panel);
    liveryMaterials.dark.add(dark);
    liveryMaterials.accent.add(accent);
    [body, panel, dark, metal, rubber, accent, lens, glass].forEach((material) => {
      material.userData.baseOpacity = material.opacity;
      material.userData.baseTransparent = material.transparent;
      material.userData.baseDepthWrite = material.depthWrite;
      allMaterials.add(material);
    });
    return { body, panel, dark, metal, rubber, accent, lens, glass };
  };

  const isTransparentMap = (mesh: THREE.Mesh): boolean => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return materials.some((material) => {
      const map = (material as THREE.MeshBasicMaterial).map;
      return Boolean(map);
    });
  };

  const registerMeshes = (group: THREE.Group, id: string, materials: Set<THREE.Material>) => {
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.userData.partId = id;
        const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
        meshMaterials.forEach((material) => {
          materials.add(material);
          allMaterials.add(material);
        });
        allMeshes.push(object);
        if (!isTransparentMap(object) && !object.userData.skipEdges) {
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(object.geometry, 34),
            edgeMaterial
          );
          edges.visible = blueprint;
          edges.userData.partId = id;
          object.add(edges);
          edgeLines.push(edges);
        }
      }
    });
  };

  const markPart = (
    group: THREE.Group,
    id: string,
    explode: [number, number, number],
    parent: THREE.Object3D = root,
    base = new THREE.Vector3(),
    adopt = true
  ): PartRecord | null => {
    group.name = id;
    group.userData.partId = id;
    if (adopt) {
      group.position.copy(base);
      parent.add(group);
    }
    const materials = new Set<THREE.Material>();
    registerMeshes(group, id, materials);
    const spec = specMap.get(id);
    if (!spec) return null;
    const record: PartRecord = {
      spec,
      group,
      base: base.clone(),
      explode: new THREE.Vector3(...explode),
      materials,
    };
    parts.set(id, record);
    return record;
  };

  const applyExplosion = () => {
    parts.forEach((part) => {
      part.group.position.copy(part.base).addScaledVector(part.explode, exploded);
    });
  };

  /* ------------------------------- hull ------------------------------ */

  const buildHull = (): void => {
    const group = new THREE.Group();
    const mats = makeMaterials();

    const profileShape = new THREE.Shape();
    profileShape.moveTo(-3.9, -0.42);
    profileShape.lineTo(3.28, -0.42);
    profileShape.lineTo(3.86, 0.04);
    profileShape.lineTo(2.7, 0.76);
    profileShape.lineTo(2.15, 0.95);
    profileShape.lineTo(1.35, 1.01);
    profileShape.lineTo(-2.9, 1.01);
    profileShape.lineTo(-3.9, 0.62);
    profileShape.closePath();
    const hullGeometry = new THREE.ExtrudeGeometry(profileShape, {
      depth: 3.36,
      bevelEnabled: true,
      bevelSize: 0.035,
      bevelThickness: 0.035,
      bevelSegments: 2,
      curveSegments: 2,
      steps: 1,
    });
    hullGeometry.rotateY(-Math.PI / 2);
    hullGeometry.translate(1.68, 0.1, 0);
    const hullShell = new THREE.Mesh(hullGeometry, mats.body);
    hullShell.userData.skipEdges = false;
    group.add(hullShell);

    // lower centre hull between the tracks
    addBox(group, mats.panel, [2.66, 0.72, 6.9], [0, -0.4, 0.05]);
    addBox(group, mats.body, [2.7, 0.26, 3.5], [0, -0.76, 0.9]);

    // upper sponsons
    addBox(group, mats.body, [0.4, 0.48, 5.1], [1.78, -0.07, -0.1]);
    addBox(group, mats.body, [0.4, 0.48, 5.1], [-1.78, -0.07, -0.1]);

    // glacis plates and bolted nose
    const glacis = addBox(group, mats.panel, [2.6, 0.12, 1.85], [0, 0.58, 2.83], [-0.39, 0, 0]);
    glacis.userData.skipEdges = true;
    addBox(group, mats.body, [2.2, 0.28, 0.4], [0, 0.16, 3.58]);
    addBox(group, mats.dark, [1.25, 0.05, 0.3], [0, 0.71, 2.38]);
    addBox(group, mats.metal, [0.16, 0.12, 0.5], [1.2, 0.24, 3.67]);
    addBox(group, mats.metal, [0.16, 0.12, 0.5], [-1.2, 0.24, 3.67]);

    // headlight guards
    ([-1, 1] as const).forEach((side) => {
      addBox(group, mats.panel, [0.46, 0.3, 0.24], [side * 1.2, 0.62, 3.14]);
      addBox(group, mats.dark, [0.3, 0.16, 0.06], [side * 1.2, 0.62, 3.27]);
      addBox(group, mats.metal, [0.06, 0.32, 0.4], [side * 1.46, 0.62, 3.12]);
      addBox(group, mats.metal, [0.06, 0.32, 0.4], [side * 0.94, 0.62, 3.12]);
      addBox(group, mats.metal, [0.58, 0.04, 0.4], [side * 1.2, 0.79, 3.12]);
      addBox(group, mats.accent, [0.24, 0.04, 0.05], [side * 1.28, 0.86, 2.82]);
    });

    // side seam lines and rear plate
    ([-1, 1] as const).forEach((side) => {
      addBox(group, mats.panel, [0.02, 0.025, 4.8], [side * 1.99, 0.48, -0.25]).userData.skipEdges = true;
      addBox(group, mats.dark, [0.06, 0.24, 0.12], [side * 1.7, -0.15, -3.65]);
      addBox(group, mats.accent, [0.16, 0.08, 0.03], [side * 1.3, 0.32, -3.9]);
    });
    addBox(group, mats.dark, [1.25, 0.42, 0.1], [0, -0.1, -3.9]);
    addBox(group, mats.panel, [2.8, 0.28, 0.25], [0, 0.05, -3.98]);
    addBox(group, mats.metal, [0.4, 0.2, 0.2], [0, -0.3, -4.02]);

    // crew heater / NBC exhaust on the right side
    addCylinder(group, mats.metal, 0.12, 0.14, 0.9, [1.85, 0.22, -1.45], "z");
    addBox(group, mats.panel, [0.24, 0.25, 0.3], [1.9, 0.22, -1.95]);

    // clean panel stencils
    const decalMaterialRight = new THREE.MeshBasicMaterial({
      map: makeDecalTexture("ABRAMS", "M1A2 SEP", true),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    const rightDecal = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 0.62), decalMaterialRight);
    rightDecal.rotation.y = Math.PI / 2;
    rightDecal.position.set(2.0, 0.23, -0.65);
    group.add(rightDecal);
    const leftDecal = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 0.62), decalMaterialRight);
    leftDecal.rotation.y = -Math.PI / 2;
    leftDecal.position.set(-2.0, 0.23, -0.65);
    group.add(leftDecal);

    // final drive housings
    ([-1, 1] as const).forEach((side) => {
      addCylinder(group, mats.panel, 0.3, 0.3, 0.28, [side * 1.62, -0.36, 3.05], "x", 18);
      addCylinder(group, mats.metal, 0.16, 0.16, 0.34, [side * 1.62, -0.36, 3.05], "x", 14);
    });

    markPart(group, "hull", [0, 1.7, 0]);
  };

  /* ---------------------------- running gear ------------------------ */

  const wheels: THREE.Group[] = [];
  const sprockets: THREE.Group[] = [];
  const driveMeshes: THREE.Group[] = [];

  const buildRunningGear = (): void => {
    const group = new THREE.Group();
    const mats = makeMaterials();

    ([-1, 1] as const).forEach((side) => {
      const x = side * 1.71;

      // continuous rubber track with central guide horns
      const track = new THREE.Mesh(
        makeTrackGeometry(0.58, 6.5, 1.26),
        mats.rubber
      );
      track.position.set(x, -0.5, 0.02);
      group.add(track);

      // track pad cleats on the exposed outer band
      for (let i = 0; i < 14; i += 1) {
        const z = -2.88 + i * (5.76 / 13);
        addBox(group, mats.dark, [0.66, 0.075, 0.26], [x, 0.14, z]);
        addBox(group, mats.dark, [0.66, 0.075, 0.26], [x, -1.14, z]);
        addBox(group, mats.metal, [0.08, 0.06, 0.15], [x, 0.205, z]);
        addBox(group, mats.metal, [0.08, 0.06, 0.15], [x, -1.205, z]);
      }
      [-1, 1].forEach((sideZ) => {
        for (let i = 0; i < 8; i += 1) {
          const angle = (-0.75 + i * 0.24);
          addBox(
            group,
            mats.dark,
            [0.66, 0.075, 0.26],
            [x, -0.5 + Math.sin(angle) * 0.73, sideZ * 3.02 + Math.cos(angle) * 0.07],
            [angle, 0, 0]
          );
        }
      });

      // road wheels: seven per side, with twin steel hubs
      for (let i = 0; i < 7; i += 1) {
        const z = -2.62 + i * 0.88;
        const wheel = addWheel(group, mats.rubber, mats.panel, x, -0.52, z, 0.45, 0.5);
        addCylinder(wheel, mats.metal, 0.2, 0.2, 0.66, [0, 0, 0], "x", 18);
        addCylinder(wheel, mats.dark, 0.09, 0.09, 0.68, [0, 0, 0], "x", 12);
        wheels.push(wheel);
        driveMeshes.push(wheel);
        addBox(group, mats.dark, [0.13, 0.52, 0.13], [x - side * 0.26, -0.08, z], [0, 0, side * 0.42]);
        addCylinder(group, mats.dark, 0.07, 0.07, 0.35, [x - side * 0.3, -0.44, z], "x", 10);
      }

      // front idler and rear drive sprocket
      const idler = addWheel(group, mats.rubber, mats.panel, x, -0.52, 3.06, 0.47, 0.5);
      const sprocket = addWheel(group, mats.metal, mats.panel, x, -0.52, -3.06, 0.53, 0.56);
      sprockets.push(idler, sprocket);
      driveMeshes.push(sprocket);
      for (let i = 0; i < 12; i += 1) {
        const angle = (i / 12) * TAU;
        const tooth = addBox(
          sprocket,
          mats.dark,
          [0.4, 0.12, 0.12],
          [0, Math.sin(angle) * 0.56, Math.cos(angle) * 0.56],
          [angle, 0, 0]
        );
        tooth.userData.skipEdges = true;
      }
      // hydraulic tensioner
      addCylinder(group, mats.metal, 0.08, 0.08, 0.62, [x, -0.13, 2.6], "z", 10);
      addBox(group, mats.panel, [0.3, 0.22, 0.5], [x, -0.06, 3.28], [0.25, 0, 0]);
    });

    markPart(group, "running-gear", [0, -1.55, 0]);
  };

  /* ---------------------------- powerpack --------------------------- */

  const buildPowerpack = (): void => {
    const group = new THREE.Group();
    const mats = makeMaterials();

    addBox(group, mats.panel, [2.7, 0.18, 2.3], [0, 1.07, -2.62]);
    addBox(group, mats.body, [2.5, 0.2, 1.9], [0, 1.18, -2.55]);

    // engine deck grille
    for (let i = 0; i < 9; i += 1) {
      const z = -1.9 - i * 0.18;
      addBox(group, mats.dark, [2.1, 0.032, 0.09], [0, 1.3, z]).userData.skipEdges = true;
    }
    addBox(group, mats.metal, [2.3, 0.055, 1.7], [0, 1.29, -2.7]).userData.skipEdges = true;
    addBox(group, mats.panel, [2.2, 0.04, 1.55], [0, 1.33, -2.7]);

    // intake and exhaust stack
    addBox(group, mats.dark, [1.15, 0.16, 0.5], [0, 1.35, -1.42]);
    for (let i = 0; i < 6; i += 1) {
      addBox(group, mats.metal, [1.0, 0.055, 0.035], [0, 1.39, -1.61 + i * 0.065]);
    }
    const exhaust = addBox(group, mats.dark, [0.58, 0.34, 0.7], [-1.12, 1.2, -3.42]);
    exhaust.rotation.x = 0.08;
    addCylinder(group, mats.metal, 0.17, 0.2, 0.28, [-1.12, 1.2, -3.78], "z", 14);
    addCylinder(group, mats.dark, 0.12, 0.15, 0.08, [-1.12, 1.2, -3.93], "z", 14);

    // cooling fans on both rear corners
    ([-1, 1] as const).forEach((side) => {
      const fan = new THREE.Group();
      fan.position.set(side * 0.95, 1.37, -3.2);
      group.add(fan);
      addCylinder(fan, mats.dark, 0.32, 0.32, 0.08, [0, 0, 0], "y", 20);
      for (let i = 0; i < 9; i += 1) {
        const angle = (i / 9) * TAU;
        const blade = addBox(fan, mats.metal, [0.27, 0.035, 0.1], [0, 0.05, 0], [0, angle, 0.25]);
        blade.position.x = Math.cos(angle) * 0.18;
        blade.position.z = Math.sin(angle) * 0.18;
      }
      addBox(group, mats.metal, [0.7, 0.05, 0.06], [side * 0.95, 1.37, -3.58]);
    });

    // transmission tunnel and rear access door
    addBox(group, mats.body, [1.4, 0.24, 0.55], [0, 1.1, -3.74]);
    addBox(group, mats.panel, [0.95, 0.55, 0.08], [0, 0.66, -3.99]);
    addBox(group, mats.dark, [0.5, 0.08, 0.03], [0, 1.02, -4.04]);
    addBox(group, mats.accent, [0.06, 0.24, 0.03], [-0.3, 0.68, -4.05]);

    markPart(group, "powerpack", [0, 1.0, -3.2]);
  };

  /* ------------------------------- turret --------------------------- */

  const turretPivot = new THREE.Group();
  turretPivot.position.y = 1.05;
  root.add(turretPivot);
  let gunPivot = new THREE.Group();
  let elevationPivot = new THREE.Group();
  let gunBarrel = new THREE.Group();
  const muzzleFlash = new THREE.Group();
  let muzzleSmoke: THREE.Group | null = null;
  let muzzleSmokeMaterial: THREE.MeshBasicMaterial | null = null;

  const buildTurret = (): void => {
    const group = new THREE.Group();
    const mats = makeMaterials();

    const shape = new THREE.Shape();
    shape.moveTo(0.9, -0.5);
    shape.lineTo(1.38, -0.62);
    shape.lineTo(1.72, -0.16);
    shape.lineTo(1.78, 1.25);
    shape.lineTo(1.32, 2.26);
    shape.lineTo(0.56, 2.43);
    shape.lineTo(-0.56, 2.43);
    shape.lineTo(-1.32, 2.26);
    shape.lineTo(-1.78, 1.25);
    shape.lineTo(-1.72, -0.16);
    shape.lineTo(-1.38, -0.62);
    shape.lineTo(-0.9, -0.5);
    shape.closePath();
    const turretGeometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.58,
      bevelEnabled: true,
      bevelSize: 0.09,
      bevelThickness: 0.08,
      bevelSegments: 3,
      curveSegments: 2,
      steps: 1,
    });
    turretGeometry.rotateX(-Math.PI / 2);
    turretGeometry.translate(0, 0.12, 0);
    const turretShell = new THREE.Mesh(turretGeometry, mats.body);
    group.add(turretShell);

    // roof plate and sloped front cheeks
    addBox(group, mats.body, [3.05, 0.12, 2.7], [0, 0.81, -0.78]);
    addBox(group, mats.panel, [1.6, 0.11, 1.1], [0, 0.84, -1.5], [-0.05, 0, 0]);
    ([-1, 1] as const).forEach((side) => {
      addBox(group, mats.body, [1.2, 0.1, 1.08], [side * 0.86, 0.68, 0.1], [-0.32, side * 0.11, side * 0.22]);
      addBox(group, mats.panel, [0.12, 0.42, 2.2], [side * 1.8, 0.42, 0.7]);
      addBox(group, mats.panel, [0.55, 0.16, 1.26], [side * 1.5, 0.62, 0.98], [0, 0, side * 0.1]);
      addBox(group, mats.dark, [0.02, 0.06, 1.65], [side * 1.94, 0.55, 0.98]).userData.skipEdges = true;
      addBox(group, mats.accent, [0.06, 0.07, 0.06], [side * 1.58, 0.78, 0.15]);
    });

    // mantlet housing
    addBox(group, mats.panel, [1.12, 0.72, 0.7], [0, 0.38, 0.28]);
    addBox(group, mats.body, [0.92, 0.5, 0.48], [0, 0.36, 0.52]);
    addBox(group, mats.dark, [0.44, 0.34, 0.2], [0, 0.34, 0.57]);

    // roof details and stowage rails
    addBox(group, mats.metal, [2.25, 0.05, 0.07], [0, 0.9, -2.25]);
    addBox(group, mats.metal, [0.07, 0.05, 0.5], [1.08, 0.9, -2.02]);
    addBox(group, mats.metal, [0.07, 0.05, 0.5], [-1.08, 0.9, -2.02]);
    for (let i = 0; i < 4; i += 1) {
      addBox(group, mats.metal, [0.06, 0.06, 0.55], [-0.66 + i * 0.44, 1.02, -2.46]);
      addBox(group, mats.metal, [0.06, 0.06, 0.55], [-0.66 + i * 0.44, 0.88, -1.92]);
    }
    addBox(group, mats.dark, [0.7, 0.18, 0.08], [0, 0.7, -2.5]);

    // track width marked on the turret cheek
    addBox(group, mats.accent, [0.22, 0.03, 0.72], [1.12, 0.76, -0.35], [0, 0, 0.04]);

    // gun pivot assembly
    gunPivot = new THREE.Group();
    gunPivot.position.set(0, 0.36, 0.45);
    group.add(gunPivot);
    elevationPivot = new THREE.Group();
    gunPivot.add(elevationPivot);

    const mantlet = addBox(elevationPivot, mats.panel, [0.98, 0.56, 0.44], [0, 0.02, 0.28]);
    mantlet.userData.skipEdges = false;
    addCylinder(elevationPivot, mats.metal, 0.18, 0.18, 1.12, [0, 0.02, 0.18], "x", 16);

    gunBarrel = new THREE.Group();
    elevationPivot.add(gunBarrel);
    addCylinder(gunBarrel, mats.metal, 0.105, 0.125, 4.8, [0, 0, 2.9], "z", 24);
    addCylinder(gunBarrel, mats.panel, 0.19, 0.21, 1.9, [0, 0, 1.78], "z", 18);
    addCylinder(gunBarrel, mats.dark, 0.225, 0.225, 0.74, [0, 0, 1.12], "z", 18);
    addCylinder(gunBarrel, mats.panel, 0.2, 0.2, 0.2, [0, 0, 1.56], "z", 18);
    addCylinder(gunBarrel, mats.metal, 0.14, 0.15, 1.2, [0, 0, 4.24], "z", 18);
    addCylinder(gunBarrel, mats.metal, 0.13, 0.13, 0.32, [0, 0, 5.16], "z", 18);
    addCylinder(gunBarrel, mats.dark, 0.15, 0.15, 0.12, [0, 0, 5.35], "z", 18);
    for (let i = 0; i < 5; i += 1) {
      addBox(gunBarrel, mats.dark, [0.32, 0.035, 0.06], [0, 0.105, 2.1 + i * 0.38]);
    }
    addBox(gunBarrel, mats.accent, [0.04, 0.16, 0.35], [0, 0.1, 2.2]);
    addCylinder(gunBarrel, mats.metal, 0.06, 0.06, 0.7, [0.2, 0.15, 0.8], "z", 10);

    // muzzle flash built into the cannon
    muzzleFlash.position.set(0, 0, 5.47);
    muzzleFlash.visible = false;
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffdd88,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    allMaterials.add(flashMaterial);
    const flashCore = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.6, 12, 1, true), flashMaterial);
    flashCore.rotation.x = Math.PI / 2;
    flashCore.position.z = 0.58;
    muzzleFlash.add(flashCore);
    for (let i = 0; i < 6; i += 1) {
      const spark = new THREE.Mesh(new THREE.ConeGeometry(0.11, 1.1, 5, 1, true), flashMaterial);
      spark.rotation.x = Math.PI / 2;
      spark.position.z = 0.4;
      spark.rotation.z = (i / 6) * TAU;
      spark.position.x = Math.cos((i / 6) * TAU) * 0.18;
      spark.position.y = Math.sin((i / 6) * TAU) * 0.18;
      muzzleFlash.add(spark);
    }
    gunBarrel.add(muzzleFlash);
    muzzleFlash.userData.skipEdges = true;

    muzzleSmokeMaterial = new THREE.MeshBasicMaterial({
      color: 0x9da28d,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    allMaterials.add(muzzleSmokeMaterial);
    muzzleSmoke = new THREE.Group();
    muzzleSmoke.position.set(0, 0, 5.5);
    for (let i = 0; i < 5; i += 1) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), muzzleSmokeMaterial);
      puff.position.set((i - 2) * 0.14, (i % 2) * 0.08, 0.4 + i * 0.2);
      puff.userData.skipEdges = true;
      muzzleSmoke.add(puff);
    }
    gunBarrel.add(muzzleSmoke);
    muzzleSmoke.userData.skipEdges = true;

    // turret basket floor visible below the ring
    addCylinder(group, mats.dark, 0.82, 0.9, 0.08, [0, -0.2, -0.86], "y", 24);

    // handle guards and tie-downs
    ([-1, 1] as const).forEach((side) => {
      addBox(group, mats.metal, [0.18, 0.04, 0.05], [side * 1.55, 0.86, -0.25]);
      addBox(group, mats.metal, [0.18, 0.04, 0.05], [side * 1.55, 0.86, -1.3]);
      addCylinder(group, mats.metal, 0.025, 0.025, 1.35, [side * 1.55, 0.91, -0.78], "z", 8);
    });

    turretPivot.add(group);
    markPart(group, "turret", [0, 1.55, -0.15], turretPivot);

    // the cannon stays docked inside the elevation pivot and is registered in place
    markPart(gunBarrel, "cannon", [0, 0.57, 0.6], turretPivot, new THREE.Vector3(), false);
  };

  /* --------------------------- crew & optics ------------------------ */

  const buildOptics = (): void => {
    const group = new THREE.Group();
    const mats = makeMaterials();

    // gunner's primary sight, front right of the roof
    addBox(group, mats.panel, [0.66, 0.36, 0.85], [0.7, 1.0, 0.32]);
    addBox(group, mats.body, [0.58, 0.15, 0.7], [0.7, 1.21, 0.28]);
    const primaryLens = addBox(group, mats.lens, [0.4, 0.22, 0.035], [0.7, 1.03, 0.76]);
    primaryLens.rotation.x = 0.05;
    addBox(group, mats.metal, [0.46, 0.28, 0.12], [0.7, 1.03, 0.7]);
    addBox(group, mats.dark, [0.3, 0.08, 0.24], [0.7, 1.26, 0.1]);

    // commander's independent thermal viewer
    const citvBase = addCylinder(group, mats.panel, 0.27, 0.3, 0.4, [0.72, 1.07, -0.75], "y", 18);
    addCylinder(group, mats.body, 0.24, 0.24, 0.24, [0.72, 1.31, -0.75], "y", 18);
    addCylinder(group, mats.metal, 0.19, 0.19, 0.1, [0.72, 1.44, -0.75], "y", 18);
    addBox(group, mats.lens, [0.23, 0.15, 0.08], [0.72, 1.36, -0.53]);
    addBox(group, mats.dark, [0.16, 0.13, 0.08], [0.72, 1.36, -0.96]);
    addBox(group, mats.panel, [0.55, 0.08, 0.5], [0.72, 0.94, -0.75]);
    citvBase.userData.skipEdges = true;

    // loader periscope and rear sensor
    addBox(group, mats.panel, [0.4, 0.2, 0.3], [-0.94, 1.08, -0.5]);
    addBox(group, mats.lens, [0.26, 0.12, 0.02], [-0.94, 1.08, -0.34]);
    addBox(group, mats.dark, [0.24, 0.21, 0.22], [-1.16, 0.92, -1.9]);
    addCylinder(group, mats.metal, 0.04, 0.04, 0.36, [-1.16, 1.08, -1.9], "y", 8);
    addBox(group, mats.dark, [0.12, 0.14, 0.06], [-1.16, 1.26, -1.9]);

    // laser warning receivers on the turret roof
    const receiverPositions: Array<[number, number]> = [
      [1.38, -2.1],
      [-1.38, -2.1],
      [1.3, 0.12],
      [-1.3, 0.12],
    ];
    receiverPositions.forEach(([x, z]) => {
      addCylinder(group, mats.dark, 0.075, 0.075, 0.15, [x, 0.94, z], "y", 10);
      addCylinder(group, mats.lens, 0.062, 0.062, 0.02, [x, 1.02, z], "y", 10);
    });

    // wind sensor mast at the rear roof
    addCylinder(group, mats.metal, 0.022, 0.022, 0.7, [-1.46, 1.16, -1.75], "y", 8);
    addBox(group, mats.dark, [0.2, 0.06, 0.06], [-1.36, 1.5, -1.75]);

    markPart(group, "optics", [0, 1.95, -0.8], turretPivot);
  };

  const buildCrew = (): void => {
    const group = new THREE.Group();
    const mats = makeMaterials();

    // commander's cupola right rear
    const cupola = addCylinder(group, mats.panel, 0.46, 0.5, 0.28, [0.66, 0.9, -1.3], "y", 22);
    cupola.userData.skipEdges = false;
    addCylinder(group, mats.body, 0.35, 0.39, 0.17, [0.66, 1.09, -1.3], "y", 22);
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * TAU;
      addBox(
        group,
        mats.dark,
        [0.18, 0.08, 0.1],
        [0.66 + Math.cos(angle) * 0.34, 1.19, -1.3 + Math.sin(angle) * 0.34],
        [0, -angle, 0]
      );
      addBox(
        group,
        mats.lens,
        [0.1, 0.045, 0.02],
        [0.66 + Math.cos(angle) * 0.4, 1.2, -1.3 + Math.sin(angle) * 0.4],
        [0, -angle, 0]
      );
    }
    // hatch lid
    addCylinder(group, mats.body, 0.31, 0.31, 0.06, [0.66, 1.17, -1.3], "y", 20);
    addCylinder(group, mats.dark, 0.21, 0.21, 0.035, [0.66, 1.21, -1.3], "y", 18);

    // loader's hatch left side
    addCylinder(group, mats.panel, 0.36, 0.4, 0.13, [-0.7, 0.9, -0.55], "y", 20);
    addCylinder(group, mats.body, 0.28, 0.3, 0.07, [-0.7, 1.0, -0.55], "y", 18);
    addBox(group, mats.metal, [0.5, 0.03, 0.06], [-0.7, 1.04, -0.55]);

    // driver's hatch on the front hull
    addCylinder(group, mats.panel, 0.34, 0.38, 0.1, [0.3, 0.99, 2.55], "y", 20);
    addCylinder(group, mats.body, 0.27, 0.29, 0.06, [0.3, 1.07, 2.55], "y", 18);
    addBox(group, mats.dark, [0.13, 0.05, 0.2], [0.3, 1.11, 2.38]);
    for (let i = 0; i < 3; i += 1) {
      addBox(group, mats.lens, [0.15, 0.035, 0.035], [0.3 + (i - 1) * 0.21, 1.07, 2.26]);
    }

    // M2HB commander's machine gun
    const mgMount = new THREE.Group();
    mgMount.position.set(0.66, 1.22, -1.3);
    group.add(mgMount);
    addCylinder(mgMount, mats.metal, 0.1, 0.12, 0.25, [0, 0.1, 0], "y", 12);
    addCylinder(mgMount, mats.dark, 0.055, 0.055, 1.0, [0, 0.3, 0.15], "z", 12);
    addBox(mgMount, mats.metal, [0.16, 0.22, 0.32], [0, 0.27, -0.22]);
    addBox(mgMount, mats.dark, [0.14, 0.18, 0.4], [0, 0.24, -0.46]);
    for (let i = 0; i < 4; i += 1) {
      addBox(mgMount, mats.metal, [0.28, 0.02, 0.02], [0, 0.27, 0.42 + i * 0.09]);
    }
    addBox(mgMount, mats.dark, [0.16, 0.11, 0.15], [0, 0.43, -0.05]);
    addCylinder(mgMount, mats.metal, 0.035, 0.035, 0.45, [0, 0.5, -0.17], "z", 8);
    addCylinder(mgMount, mats.metal, 0.03, 0.03, 0.5, [-0.13, 0.36, -0.12], "y", 8);

    // M240 loader's machine gun
    const loaderMG = new THREE.Group();
    loaderMG.position.set(-0.86, 0.98, -0.48);
    group.add(loaderMG);
    addCylinder(loaderMG, mats.metal, 0.12, 0.15, 0.3, [0, 0.08, 0], "y", 12);
    addCylinder(loaderMG, mats.dark, 0.042, 0.042, 0.85, [0, 0.24, 0.1], "z", 10);
    addBox(loaderMG, mats.dark, [0.14, 0.16, 0.32], [0, 0.22, -0.2]);
    addBox(loaderMG, mats.metal, [0.09, 0.07, 0.28], [0.12, 0.34, 0.05]);
    addCylinder(loaderMG, mats.metal, 0.025, 0.025, 0.4, [0, 0.28, 0.3], "z", 8);

    markPart(group, "crew", [0, 1.5, -2.7], turretPivot);
  };

  /* ------------------------------ stowage --------------------------- */

  const buildStowage = (): void => {
    const group = new THREE.Group();
    const mats = makeMaterials();

    // bustle rack frame
    addBox(group, mats.metal, [2.4, 0.06, 0.06], [0, 0.22, -2.85]);
    addBox(group, mats.metal, [2.4, 0.06, 0.06], [0, 0.72, -2.85]);
    addBox(group, mats.metal, [0.06, 0.56, 0.06], [1.16, 0.47, -2.85]);
    addBox(group, mats.metal, [0.06, 0.56, 0.06], [-1.16, 0.47, -2.85]);
    addBox(group, mats.metal, [0.06, 0.56, 0.06], [0, 0.47, -2.85]);
    addBox(group, mats.dark, [2.25, 0.06, 0.65], [0, 0.2, -2.52]);
    for (let i = 0; i < 4; i += 1) {
      addBox(group, mats.metal, [0.05, 0.05, 0.7], [-0.8 + i * 0.53, 0.2, -2.52]);
    }

    // canvas bags and hard cases
    const bagMaterial = new THREE.MeshStandardMaterial({
      color: 0x4e5645,
      metalness: 0.12,
      roughness: 0.9,
    });
    allMaterials.add(bagMaterial);
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.42, 0.46), bagMaterial);
    bag.position.set(-0.66, 0.58, -2.63);
    bag.rotation.z = 0.04;
    group.add(bag);
    const bag2 = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.34, 0.4), bagMaterial);
    bag2.position.set(0.32, 0.62, -2.65);
    bag2.rotation.z = -0.06;
    group.add(bag2);
    addBox(group, mats.panel, [0.7, 0.3, 0.52], [0.86, 0.52, -2.56]);
    addBox(group, mats.dark, [0.56, 0.08, 0.02], [0.86, 0.6, -2.83]);
    addBox(group, mats.accent, [0.06, 0.1, 0.02], [1.08, 0.53, -2.83]);
    addBox(group, mats.metal, [0.58, 0.06, 0.8], [0, 0.47, -2.48]);

    markPart(group, "stowage", [0, 1.45, -2.7], turretPivot);
  };

  let stowageCombat: THREE.Group | null = null;
  let stowageHeavy: THREE.Group | null = null;
  const rebuildStowageVariant = () => {
    const stowageGroup = parts.get("stowage")?.group;
    if (!stowageGroup) return;
    const mats = makeMaterials();
    stowageCombat = new THREE.Group();
    stowageCombat.name = "stowage-combat";
    stowageHeavy = new THREE.Group();
    stowageHeavy.name = "stowage-heavy";
    stowageGroup.add(stowageCombat, stowageHeavy);

    addBox(stowageCombat, mats.accent, [0.18, 0.26, 0.14], [-1.0, 0.82, -2.5]);
    const tarpMaterial = new THREE.MeshStandardMaterial({ color: 0x555c49, roughness: 0.94, metalness: 0.08 });
    allMaterials.add(tarpMaterial);
    const tarp = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 1.2, 10), tarpMaterial);
    tarp.rotation.z = Math.PI / 2;
    tarp.position.set(0.1, 0.91, -2.6);
    stowageCombat.add(tarp);
    addBox(stowageCombat, mats.panel, [0.35, 0.28, 0.4], [1.02, 0.72, -2.42]);

    addBox(stowageHeavy, mats.panel, [0.45, 0.5, 0.38], [-1.02, 0.92, -2.34]);
    addBox(stowageHeavy, mats.accent, [0.28, 0.04, 0.02], [-1.02, 1.04, -2.54]);
    addBox(stowageHeavy, mats.panel, [0.4, 0.28, 0.45], [0.98, 0.94, -2.3]);
    addBox(stowageHeavy, mats.body, [0.5, 0.32, 0.5], [0, 0.86, -2.58]);

    registerMeshes(stowageCombat, "stowage", new Set());
    registerMeshes(stowageHeavy, "stowage", new Set());
    stowageCombat.visible = armorPackage !== "clean";
    stowageHeavy.visible = armorPackage === "heavy";
  };

  /* ------------------------------- armour --------------------------- */

  const armorBase = new THREE.Group();
  const armorCombat = new THREE.Group();
  const armorHeavy = new THREE.Group();
  let turretArmorGroup: THREE.Group | null = null;

  const buildArmor = (): void => {
    const group = new THREE.Group();
    const mats = makeMaterials();
    armorBase.name = "armor-base";
    armorCombat.name = "armor-combat";
    armorHeavy.name = "armor-heavy";
    group.add(armorBase);
    turretArmorGroup = new THREE.Group();
    turretArmorGroup.name = "armor-turret";
    turretArmorGroup.add(armorCombat, armorHeavy);
    turretPivot.add(turretArmorGroup);

    // base side skirts with mud flaps and stencil decals
    ([-1, 1] as const).forEach((side) => {
      addBox(armorBase, mats.panel, [0.085, 0.54, 5.72], [side * 1.995, 0.17, -0.2]);
      addBox(armorBase, mats.body, [0.11, 0.1, 5.6], [side * 2.0, 0.47, -0.2]);
      for (let i = 0; i < 4; i += 1) {
        const z = 2.0 - i * 1.38;
        addBox(armorBase, mats.dark, [0.012, 0.46, 0.028], [side * 2.04, 0.17, z - 0.68]).userData.skipEdges = true;
      }
      addBox(armorBase, mats.dark, [0.12, 0.54, 0.22], [side * 2.0, 0.17, 2.7]);
      addBox(armorBase, mats.dark, [0.12, 0.54, 0.4], [side * 2.0, 0.17, -3.28]);
    });
    const skirtDecalMaterial = new THREE.MeshBasicMaterial({
      map: makeDecalTexture("ABRAMS", "1-64 AR", false),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    ([-1, 1] as const).forEach((side) => {
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.65, 0.58), skirtDecalMaterial);
      decal.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      decal.position.set(side * 2.045, 0.16, 0.1);
      armorBase.add(decal);
    });

    // TUSK side ERA tiles
    ([-1, 1] as const).forEach((side) => {
      for (let i = 0; i < 4; i += 1) {
        const z = 1.95 - i * 1.35;
        addBox(armorCombat, mats.body, [0.13, 0.44, 1.2], [side * 2.085, 0.15, z]);
        addBox(armorCombat, mats.body, [0.16, 0.07, 1.04], [side * 2.1, 0.39, z]);
        for (let bolt = 0; bolt < 2; bolt += 1) {
          addBox(armorCombat, mats.metal, [0.08, 0.045, 0.04], [side * 2.155, 0.32, z + (bolt === 0 ? -0.42 : 0.42)]);
        }
      }
      // front hull ERA
      addBox(armorCombat, mats.body, [0.85, 0.22, 0.4], [side * 0.9, 0.53, 3.27], [-0.36, 0, 0]);
      addBox(armorCombat, mats.body, [0.85, 0.22, 0.4], [side * 0.9, 0.53, 2.82], [-0.36, 0, 0]);
    });
    for (let i = 0; i < 4; i += 1) {
      const x = -0.72 + i * 0.48;
      addBox(armorCombat, mats.body, [0.4, 0.23, 0.22], [x, 0.4, 3.65], [-0.15, 0, 0]);
    }
    // turret cheek add-on tiles
    ([-1, 1] as const).forEach((side) => {
      addBox(armorCombat, mats.panel, [0.18, 0.46, 0.65], [side * 1.84, 0.35, 0.57], [0.14, 0, side * 0.04]);
      addBox(armorCombat, mats.dark, [0.04, 0.34, 0.48], [side * 1.95, 0.35, 0.55]);
    });

    // heavy package: Trophy radar cheeks, roof armour and slat protection
    ([-1, 1] as const).forEach((side) => {
      addBox(armorHeavy, mats.panel, [0.16, 0.5, 0.62], [side * 1.88, 0.55, -1.1]);
      addBox(armorHeavy, mats.metal, [0.3, 0.04, 0.5], [side * 1.98, 0.82, -1.1]);
      const radar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.32, 0.1, 4),
        mats.metal
      );
      radar.rotation.z = Math.PI / 2;
      radar.position.set(side * 2.05, 0.57, 0.14);
      armorHeavy.add(radar);
      addBox(armorHeavy, mats.dark, [0.12, 0.4, 0.4], [side * 1.82, 0.90, 0.8]);
      for (let i = 0; i < 4; i += 1) {
        addBox(armorHeavy, mats.metal, [0.03, 0.35, 0.03], [side * 1.94, 0.86, 0.62 + i * 0.22]);
      }
      addBox(armorHeavy, mats.body, [0.58, 0.1, 0.5], [side * 1.0, 0.92, 0.36]);
    });
    addBox(armorHeavy, mats.body, [0.34, 0.11, 1.1], [0, 1.07, -2.0]);
    addBox(armorHeavy, mats.dark, [0.25, 0.08, 0.7], [0.7, 0.96, 0.18]);
    addBox(armorHeavy, mats.accent, [0.08, 0.04, 0.15], [-1.8, 0.98, -1.8]);

    // hull skirts explode separately; turret armour follows turret traverse
    const armourPart = markPart(group, "armour", [0, 1.1, 0.45]);
    if (armourPart && turretArmorGroup) {
      registerMeshes(turretArmorGroup, "armour", armourPart.materials);
    }
    armorCombat.visible = armorPackage === "combat" || armorPackage === "heavy";
    armorHeavy.visible = armorPackage === "heavy";
  };

  /* ---------------------------- defensive --------------------------- */

  const buildDefensive = (): void => {
    const group = new THREE.Group();
    const mats = makeMaterials();

    // smoke discharger banks on both turret sides
    ([-1, 1] as const).forEach((side) => {
      const bank = new THREE.Group();
      bank.position.set(side * 1.48, 0.7, -1.72);
      bank.rotation.z = side * 0.3;
      bank.rotation.x = -0.15;
      group.add(bank);
      addBox(bank, mats.panel, [0.62, 0.26, 0.3], [0, 0, 0]);
      for (let i = 0; i < 4; i += 1) {
        addCylinder(bank, mats.dark, 0.085, 0.085, 0.44, [-0.22 + i * 0.15, 0.14, 0], "z", 12);
        addCylinder(bank, mats.metal, 0.055, 0.055, 0.07, [-0.22 + i * 0.15, 0.14, 0.26], "z", 10);
      }
      addBox(bank, mats.accent, [0.18, 0.03, 0.3], [0, 0.14, 0.1]);
    });

    // antenna bases and two whip antennas
    ([-1, 1] as const).forEach((side) => {
      addCylinder(group, mats.dark, 0.11, 0.13, 0.18, [side * 1.35, 0.98, -2.27], "y", 10);
      addCylinder(group, mats.metal, 0.018, 0.025, 1.9, [side * 1.35, 1.94, -2.27], "y", 8);
      addBox(group, mats.metal, [0.15, 0.12, 0.04], [side * 1.35, 2.72, -2.27]);
    });

    // rear warning sensor
    addBox(group, mats.dark, [0.3, 0.25, 0.18], [0, 0.75, -2.52]);
    addBox(group, mats.lens, [0.22, 0.13, 0.02], [0, 0.75, -2.63]);

    // trophy launcher pods appear in the heavy package
    const trophy = new THREE.Group();
    trophy.name = "trophy";
    group.add(trophy);
    ([-1, 1] as const).forEach((side) => {
      addBox(trophy, mats.panel, [0.24, 0.3, 0.72], [side * 1.94, 0.28, -0.72]);
      addBox(trophy, mats.metal, [0.05, 0.18, 0.55], [side * 2.08, 0.28, -0.72]);
      addBox(trophy, mats.accent, [0.06, 0.05, 0.15], [side * 2.1, 0.42, -0.8]);
    });
    trophy.visible = armorPackage === "heavy";

    markPart(group, "defensive", [0, 1.9, -1.9], turretPivot);
  };

  /* --------------------------- smoke / update ----------------------- */

  const smokeMaterial = new THREE.MeshBasicMaterial({
    color: 0x858b78,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  allMaterials.add(smokeMaterial);
  const smokePuffs: SmokePuff[] = [];
  for (let i = 0; i < 10; i += 1) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), smokeMaterial.clone());
    mesh.visible = false;
    mesh.userData.skipEdges = true;
    mesh.position.set(-1.12, 0.3, -3.8);
    allMaterials.add(mesh.material as THREE.Material);
    root.add(mesh);
    smokePuffs.push({ mesh, life: 1.6, age: 1.6, velocity: new THREE.Vector3(0, 0.2, -0.2) });
  }

  let elapsed = 0;
  let turretTarget = 0;
  let turretCurrent = 0;
  let gunTarget = 0;
  let gunCurrent = 0;
  let scanning = false;
  let driving = false;
  let driveSpeed = 0; // signed m/s for wheel spin (game extension)
  let spawnTimer = 0;
  let recoil = 0;
  let muzzleTimer = 0;
  let baseBarrelZ = 0;

  const setTurret = (degrees: number) => {
    scanning = false;
    turretTarget = THREE.MathUtils.clamp(degrees, -180, 180);
  };
  const setGun = (degrees: number) => {
    gunTarget = THREE.MathUtils.clamp(degrees, -8, 20);
  };
  const setScan = (enabled: boolean) => {
    scanning = enabled;
  };
  const setDrive = (enabled: boolean) => {
    driving = enabled;
    driveSpeed = enabled ? 5 : 0;
  };
  const setDriveSpeed = (metresPerSecond: number) => {
    driveSpeed = THREE.MathUtils.clamp(metresPerSecond, -20, 20);
    driving = Math.abs(driveSpeed) > 0.05;
  };
  const fire = () => {
    recoil = 1;
    muzzleTimer = 0.3;
    muzzleFlash.visible = true;
    muzzleFlash.scale.setScalar(1);
    const flashMaterial = (muzzleFlash.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    flashMaterial.opacity = 1;
  };

  const update = (dt: number) => {
    const delta = Math.min(dt, 0.05);
    elapsed += delta;

    if (scanning) {
      turretTarget = Math.sin(elapsed * 0.36) * 34;
    }
    turretCurrent = THREE.MathUtils.damp(turretCurrent, turretTarget, 2.8, delta);
    turretPivot.rotation.y = THREE.MathUtils.degToRad(turretCurrent);
    gunCurrent = THREE.MathUtils.damp(gunCurrent, gunTarget, 3.5, delta);
    gunPivot.rotation.x = -THREE.MathUtils.degToRad(gunCurrent);

    if (baseBarrelZ === 0) baseBarrelZ = gunBarrel.position.z;
    if (recoil > 0) {
      recoil = Math.max(0, recoil - delta * 4.8);
      const kick = Math.sin(recoil * Math.PI) * 0.34;
      gunBarrel.position.z = baseBarrelZ - kick;
    } else {
      gunBarrel.position.z = baseBarrelZ;
    }

    if (muzzleTimer > 0) {
      muzzleTimer -= delta;
      muzzleFlash.visible = true;
      const progress = 1 - Math.max(0, muzzleTimer / 0.3);
      muzzleFlash.scale.setScalar(0.8 + progress * 1.9);
      muzzleFlash.rotation.z = progress * 0.9;
      const flashMaterial = (muzzleFlash.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      flashMaterial.opacity = Math.max(0, 1 - progress * 1.05);
      if (muzzleSmoke && muzzleSmokeMaterial) {
        muzzleSmoke.visible = true;
        muzzleSmoke.children.forEach((puff, index) => {
          puff.scale.setScalar(0.5 + progress * (2.6 + index * 0.32));
          puff.position.z = 0.5 + progress * (0.9 + index * 0.5);
        });
        muzzleSmokeMaterial.opacity = Math.max(0, 0.36 * (1 - progress));
      }
    } else {
      muzzleFlash.visible = false;
      if (muzzleSmoke) muzzleSmoke.visible = false;
    }

    if (driving) {
      // Wheel angular rate from ground speed (road-wheel radius ~0.345 m);
      // signed, so reverse rolls the running gear backwards.
      const spin = delta * driveSpeed * 2.9;
      driveMeshes.forEach((mesh) => {
        mesh.rotation.x -= spin;
      });
    }

    spawnTimer -= delta;
    if (driving && spawnTimer <= 0) {
      spawnTimer = 0.13;
      const available = smokePuffs.find((puff) => puff.age >= puff.life);
      if (available) {
        available.age = 0;
        available.mesh.visible = true;
        available.mesh.position.set(-1.1, 1.25, -3.92);
        available.mesh.scale.setScalar(0.5);
        (available.mesh.material as THREE.MeshBasicMaterial).opacity = 0.26;
        available.velocity.set(
          (Math.random() - 0.5) * 0.12,
          0.35 + Math.random() * 0.18,
          -0.45 - Math.random() * 0.3
        );
      }
    }
    smokePuffs.forEach((puff) => {
      if (puff.age >= puff.life) {
        puff.mesh.visible = false;
        return;
      }
      puff.age += delta;
      const progress = puff.age / puff.life;
      puff.mesh.position.addScaledVector(puff.velocity, delta);
      puff.mesh.scale.setScalar(0.45 + progress * 3.1);
      (puff.mesh.material as THREE.MeshBasicMaterial).opacity = 0.24 * (1 - progress);
    });
  };

  const setArmor = (id: ArmorId) => {
    armorPackage = id;
    armorCombat.visible = id === "combat" || id === "heavy";
    armorHeavy.visible = id === "heavy";
    const trophy = parts.get("defensive")?.group.getObjectByName("trophy");
    if (trophy) trophy.visible = id === "heavy";
    if (stowageCombat) stowageCombat.visible = id !== "clean";
    if (stowageHeavy) stowageHeavy.visible = id === "heavy";
    armorPackage = id;
  };

  const setLivery = (id: LiveryId) => {
    palette = LIVERY_PRESETS.find((item) => item.id === id) ?? LIVERY_PRESETS[0];
    liveryMaterials.body.forEach((material) => {
      material.color.set(palette.body);
    });
    liveryMaterials.panel.forEach((material) => {
      material.color.set(palette.panel);
    });
    liveryMaterials.dark.forEach((material) => {
      material.color.set(palette.dark);
    });
    liveryMaterials.accent.forEach((material) => {
      material.color.set(palette.accent);
    });
  };

  const setExplode = (amount: number) => {
    exploded = THREE.MathUtils.clamp(amount, 0, 1);
    applyExplosion();
  };

  const setBlueprint = (enabled: boolean) => {
    blueprint = enabled;
    allMaterials.forEach((material) => {
      if (material === smokeMaterial) return;
      const mat = material as THREE.MeshStandardMaterial;
      if (mat.userData.baseOpacity === undefined) {
        mat.userData.baseOpacity = mat.opacity;
        mat.userData.baseTransparent = mat.transparent;
        mat.userData.baseDepthWrite = mat.depthWrite;
      }
      if (mat.blending === THREE.AdditiveBlending) return;
      if (enabled) {
        mat.transparent = true;
        mat.opacity = Math.min(mat.userData.baseOpacity, 0.1);
        mat.depthWrite = false;
      } else {
        mat.transparent = mat.userData.baseTransparent as boolean;
        mat.opacity = mat.userData.baseOpacity as number;
        mat.depthWrite = mat.userData.baseDepthWrite as boolean;
      }
      mat.needsUpdate = true;
    });
    edgeLines.forEach((line) => {
      line.visible = enabled;
    });
  };

  const setSolo = (id: string | null) => {
    // Mesh-level isolation keeps parent pivots (turret ring, gun cradle)
    // intact, so nested assemblies such as the cannon remain visible.
    parts.forEach((part) => {
      part.group.visible = true;
    });
    root.traverse((object) => {
      if (object instanceof THREE.Mesh && typeof object.userData.partId === "string") {
        object.visible = !id || object.userData.partId === id;
      }
      if (object instanceof THREE.LineSegments && typeof object.userData.partId === "string") {
        object.visible = blueprint && (!id || object.userData.partId === id);
      }
    });
    if (turretArmorGroup) turretArmorGroup.visible = true;
  };

  const setHighlight = (id: string | null, strength: number) => {
    if (!id) return;
    const part = parts.get(id);
    if (!part) return;
    part.materials.forEach((material) => {
      if ("emissive" in material) {
        const mat = material as THREE.MeshStandardMaterial;
        mat.emissive.set(strength > 0 ? 0xd6e879 : 0x000000);
        mat.emissiveIntensity = strength;
      }
    });
  };

  const getStats = () => {
    let meshes = 0;
    let triangles = 0;
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        meshes += 1;
        if (object.geometry.index) triangles += object.geometry.index.count / 3;
        else if (object.geometry.attributes.position) {
          triangles += object.geometry.attributes.position.count / 3;
        }
      }
    });
    return {
      parts: parts.size,
      meshes,
      triangles: Math.round(triangles),
      materials: allMaterials.size,
    };
  };

  const dispose = () => {
    root.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
      }
    });
    allMeshes.length = 0;
    edgeLines.length = 0;
    allMaterials.forEach((material) => material.dispose());
    edgeMaterial.dispose();
    smokePuffs.forEach((puff) => puff.mesh.geometry.dispose());
  };

  /* ------------------------------ build ----------------------------- */

  buildHull();
  buildRunningGear();
  buildPowerpack();
  buildTurret();
  buildOptics();
  buildCrew();
  buildStowage();
  buildArmor();
  buildDefensive();
  rebuildStowageVariant();
  applyExplosion();

  // wheel groups are already part of running gear; the cannon group is shared
  setArmor(initialArmor);

  const muzzleMaterial = (muzzleFlash.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
  muzzleMaterial.userData.baseOpacity = 1;
  muzzleMaterial.userData.baseTransparent = true;
  muzzleMaterial.userData.baseDepthWrite = false;

  return {
    root,
    parts,
    partSpecs: PART_SPECS,
    setLivery,
    setArmor,
    setExplode,
    setBlueprint,
    setHighlight,
    setSolo,
    setTurret,
    setGun,
    setScan,
    setDrive,
    setDriveSpeed,
    rig: { turretPivot, gunPivot, gunBarrel, muzzle: muzzleFlash },
    fire,
    update,
    getRig: () => ({ turret: turretCurrent, gun: gunCurrent }),
    getStats,
    dispose,
  };
}
