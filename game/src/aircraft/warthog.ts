/**
 * WARTHOG AIRFRAME FACTORY
 * ------------------------------------------------------------------
 * A dependency-free (Three.js only) procedural A-10C reference model.
 * Every visible component is generated from primitives, lofts and
 * extrusions. No meshes, textures or fonts are downloaded at runtime.
 *
 * Coordinate system: +Z = nose, +X = starboard, +Y = up. Units: metres.
 * Reuse: const aircraft = createWarthogAssembly(); scene.add(aircraft.root)
 */

import * as THREE from "three";

export type LiveryId = "sage" | "ghost" | "sand" | "primer";
export type LoadoutId = "clean" | "standard" | "heavy";
export type PartCategory =
  | "Airframe"
  | "Wings"
  | "Propulsion"
  | "Armament"
  | "Systems"
  | "Undercarriage";

export interface PartSpec {
  id: string;
  code: string;
  name: string;
  category: PartCategory;
  summary: string;
  material: string;
  massKg: number;
  /** length (Z), span (X), height (Y) in metres */
  dimensions: [number, number, number];
  note: string;
}

export const WARTHOG_SPECS = {
  designation: "A-10C Thunderbolt II",
  nickname: "Warthog",
  role: "Close air support / forward air control",
  crew: "1",
  lengthM: 16.26,
  wingspanM: 17.53,
  heightM: 4.47,
  wingAreaM2: 47.0,
  emptyMassKg: 11321,
  maxMassKg: 23000,
  engine: "2 × General Electric TF34-GE-100A",
  thrustKN: 80.6,
  maxSpeedKmh: 706,
  combatRadiusKm: 460,
  gun: "GAU-8/A Avenger, 30 mm",
  gunRate: 3900,
  rounds: 1174,
  firstFlight: 1972,
  unitsBuilt: 716,
};

export const PART_SPECS: PartSpec[] = [
  {
    id: "fuselage",
    code: "W-01",
    name: "Fuselage",
    category: "Airframe",
    summary:
      "Semi-monocoque centre fuselage and forward avionics bay. The gun is carried slightly off the centreline.",
    material: "2024-T3 aluminium / titanium",
    massKg: 2180,
    dimensions: [15.1, 1.86, 1.82],
    note: "The titanium «bathtub» protects the pilot from ground fire. The nose section houses the Avenger's ammunition drum.",
  },
  {
    id: "canopy",
    code: "W-02",
    name: "Cockpit & Canopy",
    category: "Systems",
    summary:
      "Single-seat cockpit with a bubble canopy, armoured tub, HOTAS controls and a wide-angle HUD.",
    material: "Polycarbonate / aluminium frame",
    massKg: 118,
    dimensions: [2.8, 1.16, 0.92],
    note: "Bubble canopy delivers exceptional downward visibility for target identification and strafing runs.",
  },
  {
    id: "wing-port",
    code: "W-03",
    name: "Port wing",
    category: "Wings",
    summary:
      "Long, high-aspect tapered wing with three weapon stations and a wingtip Sidewinder rail.",
    material: "Aluminium alloy / composite",
    massKg: 1096,
    dimensions: [3.28, 8.77, 0.34],
    note: "The broad wing gives the A-10 a low stall speed and a tight combat turn radius at low altitude.",
  },
  {
    id: "wing-starboard",
    code: "W-04",
    name: "Starboard wing",
    category: "Wings",
    summary:
      "Mirrored wing panel with hardpoints, flaps and the starboard navigation light.",
    material: "Aluminium alloy / composite",
    massKg: 1096,
    dimensions: [3.28, 8.77, 0.34],
    note: "Wing stations are plumbed for fuel, electrical power and stores release.",
  },
  {
    id: "engine-port",
    code: "W-05",
    name: "Port engine",
    category: "Propulsion",
    summary:
      "High-mounted TF34 turbofan in a podded nacelle, with the intake clear of wing wake.",
    material: "Titanium / Nomex nacelle",
    massKg: 1470,
    dimensions: [3.9, 1.42, 1.48],
    note: "The unusual high engine position keeps the intakes clear of debris thrown up by the nose wheel.",
  },
  {
    id: "engine-starboard",
    code: "W-06",
    name: "Starboard engine",
    category: "Propulsion",
    summary:
      "Mirrored TF34 turbofan nacelle with exhaust nozzle, accessory bay and pylon fairing.",
    material: "Titanium / Nomex nacelle",
    massKg: 1470,
    dimensions: [3.9, 1.42, 1.48],
    note: "Each TF34 produces 40.3 kN of thrust. The engines are cross-fed from the main fuel system.",
  },
  {
    id: "empennage",
    code: "W-07",
    name: "Tail assembly",
    category: "Airframe",
    summary:
      "Twin vertical stabilisers and a low-set horizontal stabiliser with a compact elevator.",
    material: "Aluminium alloy / honeycomb",
    massKg: 490,
    dimensions: [2.7, 5.5, 2.72],
    note: "The twin-fin layout preserves directional control when the engines are throttled asymmetrically.",
  },
  {
    id: "gun",
    code: "W-08",
    name: "GAU-8/A Avenger",
    category: "Armament",
    summary:
      "Seven-barrel, 30 mm rotary cannon underslung beneath the forward fuselage.",
    material: "Steel / titanium housing",
    massKg: 281,
    dimensions: [6.06, 0.5, 0.55],
    note: "The gun and its 1,174-round magazine account for a substantial share of the empty weight. Rate of fire: 3,900 rounds/min.",
  },
  {
    id: "stores",
    code: "W-09",
    name: "Hardpoints & stores",
    category: "Armament",
    summary:
      "Eleven external stations carrying precision munitions, rocket pods, fuel tanks and self-defence missiles.",
    material: "Various mission stores",
    massKg: 1480,
    dimensions: [2.2, 16.8, 0.8],
    note: "The rail is loadout-aware: choose Clean, Standard or Heavy in the factory toolbar to rebuild this assembly.",
  },
  {
    id: "gear",
    code: "W-10",
    name: "Landing gear",
    category: "Undercarriage",
    summary:
      "Trailing-link main gear and a twin-wheel nose gear, rebuilt for the unpaved-field role.",
    material: "High-strength steel / rubber",
    massKg: 560,
    dimensions: [3.6, 4.3, 2.1],
    note: "A-10 gear is deliberately long and wide-tracked to let the aircraft operate from rough forward strips.",
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
    id: "sage",
    label: "Sage",
    swatch: "#7e8974",
    body: "#7e8974",
    panel: "#69745f",
    accent: "#d4e665",
    dark: "#454d41",
  },
  {
    id: "ghost",
    label: "Ghost grey",
    swatch: "#8b9695",
    body: "#8b9695",
    panel: "#778281",
    accent: "#cde06b",
    dark: "#4a5454",
  },
  {
    id: "sand",
    label: "Sand",
    swatch: "#a99677",
    body: "#a99677",
    panel: "#907f63",
    accent: "#efbd4e",
    dark: "#585040",
  },
  {
    id: "primer",
    label: "Primer",
    swatch: "#a9ada1",
    body: "#a9ada1",
    panel: "#94988c",
    accent: "#e0a23b",
    dark: "#4c5047",
  },
];

export const LOADOUTS: Array<{
  id: LoadoutId;
  label: string;
  count: number;
  massKg: number;
}> = [
  { id: "clean", label: "Clean", count: 0, massKg: 0 },
  { id: "standard", label: "Standard", count: 8, massKg: 1480 },
  { id: "heavy", label: "Heavy", count: 13, massKg: 3560 },
];

interface Mats {
  body: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  ordnance: THREE.MeshStandardMaterial;
  tyre: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  screen: THREE.MeshBasicMaterial;
}

interface PartRecord {
  spec: PartSpec;
  group: THREE.Group;
  base: THREE.Vector3;
  explode: THREE.Vector3;
  materials: Set<THREE.Material>;
}

export interface WarthogAssembly {
  root: THREE.Group;
  parts: Map<string, PartRecord>;
  partSpecs: PartSpec[];
  setLivery: (id: LiveryId) => void;
  setLoadout: (id: LoadoutId) => void;
  setExplode: (amount: number) => void;
  setBlueprint: (enabled: boolean) => void;
  setHighlight: (id: string | null, strength: number) => void;
  setSolo: (id: string | null) => void;
  /** 0 = canopy latched, 1 = canopy fully raised on its rear hinge. */
  setCanopyOpen: (amount: number) => void;
  /** Hide only the canopy glass for an unobstructed first-person cockpit. */
  setCockpitView: (enabled: boolean) => void;
  setGearDown: (down: boolean) => void;
  getStats: () => { parts: number; meshes: number; triangles: number; materials: number };
  dispose: () => void;
}

/* ------------------------------------------------------------------ */
/* geometry helpers                                                    */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;

interface LoftSection {
  z: number;
  w: number;
  h: number;
  y?: number;
  exponent?: number;
}

/** Superellipse loft. Sections must be ordered from high Z to low Z. */
function loft(sections: LoftSection[], segments = 32): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  sections.forEach((section, row) => {
    const exponent = section.exponent ?? 2.5;
    const power = 2 / exponent;
    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * TAU;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const x = Math.sign(c) * Math.pow(Math.abs(c), power) * section.w;
      const y =
        (section.y ?? 0) +
        Math.sign(s) * Math.pow(Math.abs(s), power) * section.h;
      positions.push(x, y, section.z);
      uvs.push(i / segments, row / Math.max(1, sections.length - 1));
    }
  });

  for (let row = 0; row < sections.length - 1; row += 1) {
    for (let i = 0; i < segments; i += 1) {
      const next = (i + 1) % segments;
      const a = row * segments + i;
      const b = row * segments + next;
      const c = (row + 1) * segments + i;
      const d = (row + 1) * segments + next;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function mirrorGeometryX(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = source.clone();
  geometry.scale(-1, 1, 1);
  if (geometry.index) {
    const idx = geometry.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const tmp = idx[i];
      idx[i] = idx[i + 2];
      idx[i + 2] = tmp;
    }
    geometry.index.needsUpdate = true;
  } else {
    for (const attribute of Object.values(geometry.attributes)) {
      const array = attribute.array as Float32Array;
      const size = attribute.itemSize;
      for (let tri = 0; tri < array.length; tri += size * 3) {
        for (let k = 0; k < size; k += 1) {
          const a = tri + k;
          const b = tri + size * 2 + k;
          const tmp = array[a];
          array[a] = array[b];
          array[b] = tmp;
        }
      }
      attribute.needsUpdate = true;
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

function addBox(
  group: THREE.Group,
  material: THREE.Material,
  size: [number, number, number],
  position: [number, number, number],
  rotation?: [number, number, number]
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  group.add(mesh);
  return mesh;
}

function addStrut(
  group: THREE.Group,
  material: THREE.Material,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number
): THREE.Mesh {
  const direction = new THREE.Vector3().subVectors(to, from);
  const length = direction.length();
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 0.92, length, 10),
    material
  );
  mesh.position.copy(from).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.clone().normalize()
  );
  group.add(mesh);
  return mesh;
}

function addWheel(
  group: THREE.Group,
  tyre: THREE.Material,
  hub: THREE.Material,
  position: [number, number, number],
  radius: number,
  width: number
): void {
  const wheel = new THREE.Mesh(
    new THREE.TorusGeometry(radius, width, 12, 28),
    tyre
  );
  wheel.rotation.y = Math.PI / 2;
  wheel.position.set(...position);
  group.add(wheel);

  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width * 2.15, 18),
    hub
  );
  drum.rotation.z = Math.PI / 2;
  drum.position.set(...position);
  group.add(drum);
}

function makeInsigniaTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, 512, 512);
    ctx.fillStyle = "rgba(57, 65, 51, 0.68)";
    ctx.beginPath();
    ctx.arc(256, 256, 176, 0, TAU);
    ctx.fill();
    // five-point star, flat-top orientation
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const radius = i % 2 === 0 ? 150 : 63;
      const angle = -Math.PI / 2 + (i / 10) * TAU;
      const x = 256 + Math.cos(angle) * radius;
      const y = 256 + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(218, 222, 200, 0.8)";
    ctx.fill();
    ctx.fillStyle = "rgba(57, 65, 51, 0.68)";
    ctx.fillRect(430, 234, 72, 44);
    ctx.fillRect(10, 234, 72, 44);
    ctx.strokeStyle = "rgba(218, 222, 200, 0.8)";
    ctx.lineWidth = 5;
    ctx.strokeRect(430, 234, 72, 44);
    ctx.strokeRect(10, 234, 72, 44);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function makeDecalTexture(title: string, subtitle: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, 512, 160);
    ctx.fillStyle = "rgba(35, 39, 32, 0.82)";
    ctx.font = "700 74px 'Arial Narrow', Arial, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(title, 18, 62);
    ctx.font = "600 24px monospace";
    ctx.letterSpacing = "5px";
    ctx.fillText(subtitle, 22, 122);
    ctx.fillStyle = "rgba(209, 227, 112, 0.9)";
    ctx.fillRect(18, 91, 158, 5);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/* ------------------------------------------------------------------ */
/* assembly                                                            */
/* ------------------------------------------------------------------ */

export function createWarthogAssembly(
  initialLivery: LiveryId = "sage",
  initialLoadout: LoadoutId = "standard"
): WarthogAssembly {
  const root = new THREE.Group();
  root.name = "A-10C_Thunderbolt_II";
  const parts = new Map<string, PartRecord>();
  const liveryMaterials: Record<"body" | "panel" | "accent" | "dark", Set<THREE.MeshStandardMaterial>> = {
    body: new Set(),
    panel: new Set(),
    accent: new Set(),
    dark: new Set(),
  };
  const allMaterials = new Set<THREE.Material>();
  const allMeshes: THREE.Mesh[] = [];
  const edgeLines: THREE.LineSegments[] = [];
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0xc8df86,
    transparent: true,
    opacity: 0.62,
  });
  let palette = LIVERY_PRESETS.find((item) => item.id === initialLivery) ?? LIVERY_PRESETS[0];
  let exploded = 0;
  let blueprint = false;
  let canopyPivot: THREE.Group | null = null;
  let canopyGlass: THREE.Mesh | null = null;
  let canopyOpenAmount = 0;
  const specMap = new Map(PART_SPECS.map((spec) => [spec.id, spec]));

  const makeMaterials = (): Mats => {
    const body = new THREE.MeshStandardMaterial({
      color: palette.body,
      metalness: 0.28,
      roughness: 0.64,
      envMapIntensity: 0.7,
    });
    const panel = new THREE.MeshStandardMaterial({
      color: palette.panel,
      metalness: 0.34,
      roughness: 0.58,
      envMapIntensity: 0.6,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: palette.dark,
      metalness: 0.25,
      roughness: 0.65,
      envMapIntensity: 0.25,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: 0xadb3aa,
      metalness: 0.92,
      roughness: 0.3,
      envMapIntensity: 1,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: palette.accent,
      metalness: 0.25,
      roughness: 0.5,
    });
    const ordnance = new THREE.MeshStandardMaterial({
      color: 0x6c705c,
      metalness: 0.3,
      roughness: 0.6,
    });
    const tyre = new THREE.MeshStandardMaterial({
      color: 0x1d201c,
      metalness: 0.1,
      roughness: 0.85,
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x273634,
      metalness: 0.42,
      roughness: 0.08,
      transparent: true,
      opacity: 0.58,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.35,
      side: THREE.DoubleSide,
    });
    const screen = new THREE.MeshBasicMaterial({ color: 0x9ad18e });
    screen.userData.noHighlight = true;

    liveryMaterials.body.add(body);
    liveryMaterials.panel.add(panel);
    liveryMaterials.accent.add(accent);
    liveryMaterials.dark.add(dark);
    [body, panel, dark, metal, accent, ordnance, tyre, glass, screen].forEach((mat) => {
      mat.userData.baseEmissive = 0x000000;
      allMaterials.add(mat);
    });
    return { body, panel, dark, metal, accent, ordnance, tyre, glass, screen };
  };

  const markPart = (
    group: THREE.Group,
    id: string,
    explode: [number, number, number],
    materials: Set<THREE.Material>,
    base = new THREE.Vector3()
  ) => {
    group.name = id;
    group.userData.partId = id;
    group.position.copy(base);
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.userData.partId = id;
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        mats.forEach((mat) => materials.add(mat));
        allMeshes.push(object);
        const isDecal = matIsTransparentMap(object);
        if (!isDecal && !object.userData.skipEdges) {
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(object.geometry, 32),
            edgeMaterial
          );
          edges.visible = false;
          edges.userData.partId = id;
          object.add(edges);
          edgeLines.push(edges);
        }
      }
    });
    root.add(group);
    const spec = specMap.get(id);
    if (spec) {
      parts.set(id, {
        spec,
        group,
        base: base.clone(),
        explode: new THREE.Vector3(...explode),
        materials,
      });
    }
  };

  const matIsTransparentMap = (mesh: THREE.Mesh): boolean => {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return mats.some(
      (mat) => (mat as THREE.MeshBasicMaterial).map !== undefined && (mat as THREE.MeshBasicMaterial).map !== null
    );
  };

  const applyExplosion = () => {
    parts.forEach((part) => {
      part.group.position
        .copy(part.base)
        .addScaledVector(part.explode, exploded);
    });
  };

  /* ----------------------------- fuselage ---------------------------- */

  const buildFuselage = (): void => {
    const group = new THREE.Group();
    const mats = makeMaterials();
    const materials = new Set<THREE.Material>();

    const hull = new THREE.Mesh(
      loft([
        { z: 6.95, w: 0.34, h: 0.31, y: -0.16 },
        { z: 6.35, w: 0.54, h: 0.5, y: -0.17 },
        { z: 5.6, w: 0.7, h: 0.66, y: -0.13 },
        { z: 4.7, w: 0.84, h: 0.82, y: -0.05 },
        { z: 3.8, w: 0.94, h: 1.04, y: 0.07 },
        { z: 2.9, w: 1.02, h: 1.14, y: 0.11 },
        { z: 1.8, w: 1.08, h: 1.16, y: 0.08 },
        { z: 0.3, w: 1.1, h: 1.08, y: 0.01 },
        { z: -1.4, w: 1.05, h: 0.98, y: 0.02 },
        { z: -2.9, w: 0.94, h: 0.87, y: 0.08 },
        { z: -4.2, w: 0.79, h: 0.72, y: 0.17 },
        { z: -5.4, w: 0.59, h: 0.56, y: 0.27 },
        { z: -6.25, w: 0.4, h: 0.37, y: 0.34 },
        { z: -6.8, w: 0.18, h: 0.17, y: 0.37 },
        { z: -6.94, w: 0.04, h: 0.04, y: 0.38 },
      ]),
      mats.body
    );
    group.add(hull);

    const radome = new THREE.Mesh(
      loft([
        { z: 8.28, w: 0.12, h: 0.12, y: -0.18, exponent: 2.1 },
        { z: 8.22, w: 0.2, h: 0.19, y: -0.18, exponent: 2.2 },
        { z: 8.1, w: 0.27, h: 0.25, y: -0.18, exponent: 2.3 },
        { z: 7.9, w: 0.32, h: 0.3, y: -0.17, exponent: 2.45 },
        { z: 7.6, w: 0.35, h: 0.33, y: -0.16, exponent: 2.55 },
        { z: 7.2, w: 0.37, h: 0.35, y: -0.15, exponent: 2.6 },
        { z: 6.95, w: 0.38, h: 0.36, y: -0.16, exponent: 2.5 },
      ]),
      mats.panel
    );
    group.add(radome);

    const noseTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 12, 8),
      mats.metal
    );
    noseTip.position.set(0, -0.18, 8.27);
    noseTip.scale.set(1.1, 1, 0.6);
    group.add(noseTip);

    const pitot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.02, 0.55, 8),
      mats.metal
    );
    pitot.rotation.x = Math.PI / 2;
    pitot.position.set(-0.2, -0.17, 8.38);
    group.add(pitot);

    // dorsal spine / avionics service fairing
    const spine = new THREE.Mesh(
      loft([
        { z: 2.2, w: 0.24, h: 0.12, y: 1.16, exponent: 4 },
        { z: 1.1, w: 0.28, h: 0.14, y: 1.2, exponent: 4 },
        { z: -0.6, w: 0.24, h: 0.12, y: 1.08, exponent: 4 },
        { z: -1.2, w: 0.12, h: 0.06, y: 1.0, exponent: 4 },
      ]),
      mats.panel
    );
    group.add(spine);

    // under-fuselage gun fairing
    const gunFairing = new THREE.Mesh(
      loft([
        { z: 6.6, w: 0.3, h: 0.1, y: -0.82, exponent: 3 },
        { z: 5.4, w: 0.38, h: 0.24, y: -0.9, exponent: 3 },
        { z: 3.6, w: 0.42, h: 0.3, y: -0.9, exponent: 3 },
        { z: 2.0, w: 0.3, h: 0.18, y: -0.96, exponent: 3 },
      ]),
      mats.panel
    );
    group.add(gunFairing);

    // ventral blade antennae
    addBox(group, mats.dark, [0.05, 0.34, 0.5], [0, -1.03, 1.3], [0.32, 0, 0]);
    addBox(group, mats.dark, [0.045, 0.22, 0.3], [0, -0.89, -2.5], [0.2, 0, 0]);
    addBox(group, mats.metal, [0.025, 0.035, 0.65], [0.58, 0.5, 6.1], [0, 0, 0.18]);

    // yellow rescue markings by the canopy sills
    addBox(group, mats.accent, [0.02, 0.055, 0.46], [0.86, 0.42, 4.06]);
    addBox(group, mats.accent, [0.02, 0.055, 0.46], [-0.86, 0.42, 4.06]);

    // matte anti-glare shield forward of the windshield
    const glare = addBox(group, mats.dark, [0.66, 0.025, 1.5], [0, 0.53, 5.6], [-0.21, 0, 0]);
    glare.userData.skipEdges = true;
    const glareTip = addBox(group, mats.dark, [0.46, 0.02, 0.46], [0, 0.45, 6.43], [-0.21, 0, 0]);
    glareTip.userData.skipEdges = true;

    // refuelling receptacle and formation strips
    const receptacle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.025, 14), mats.dark);
    receptacle.position.set(0, 1.125, 0.2);
    group.add(receptacle);
    receptacle.userData.skipEdges = true;
    addBox(group, mats.accent, [0.015, 0.035, 0.28], [0.885, 0.15, 1.5]);
    addBox(group, mats.accent, [0.015, 0.035, 0.28], [-0.885, 0.15, 1.5]);

    // longitudinal panel seams on the dorsal deck
    const seamMaterial = new THREE.MeshStandardMaterial({
      color: 0x5b6354,
      metalness: 0.4,
      roughness: 0.6,
    });
    materials.add(seamMaterial);
    allMaterials.add(seamMaterial);
    addBox(group, seamMaterial, [0.012, 0.012, 2.4], [0.36, 1.06, 1.1]).userData.skipEdges = true;
    addBox(group, seamMaterial, [0.012, 0.012, 2.1], [-0.4, 1.0, 0.4]).userData.skipEdges = true;
    addBox(group, seamMaterial, [0.012, 0.012, 1.4], [0.55, 0.66, 2.3]).userData.skipEdges = true;
    addBox(group, seamMaterial, [0.012, 0.012, 1.4], [-0.55, 0.66, 2.3]).userData.skipEdges = true;

    // stencils
    const decalMatRight = new THREE.MeshBasicMaterial({
      map: makeDecalTexture("A-10C", "THUNDERBOLT II"),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    const decalRight = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.32), decalMatRight);
    decalRight.rotation.y = Math.PI / 2;
    // Sit the stencil on the forward-fuselage skin (the pack's original
    // z=6.34/y=0.58 placement floated above the tapered nose in game).
    decalRight.position.set(0.76, -0.02, 5.25);
    group.add(decalRight);

    const decalLeft = decalRight.clone();
    decalLeft.rotation.y = -Math.PI / 2;
    decalLeft.position.set(-0.76, -0.02, 5.25);
    group.add(decalLeft);

    markPart(group, "fuselage", [0, 0.35, 0], materials);
  };

  /* ----------------------------- cockpit ----------------------------- */

  const buildCanopy = (): void => {
    const group = new THREE.Group();
    const mats = makeMaterials();
    const materials = new Set<THREE.Material>();

    // Cockpit floor and side consoles. The original solid 2.5 m tub filled
    // the pilot's lower view as one flat slab; this keeps the same seat and
    // station geometry while giving the first-person camera a real panel,
    // pedestal, stick and consoles to look at.
    const tub = addBox(group, mats.dark, [0.86, 0.18, 1.9], [0, 0.98, 3.25]);
    tub.userData.skipEdges = true;
    addBox(group, mats.dark, [0.24, 0.2, 1.25], [-0.43, 1.13, 3.28]).userData.skipEdges = true;
    addBox(group, mats.dark, [0.24, 0.2, 1.25], [0.43, 1.13, 3.28]).userData.skipEdges = true;
    addBox(group, mats.dark, [0.24, 0.28, 0.72], [0, 1.0, 3.9]).userData.skipEdges = true;

    const seat = addBox(group, mats.panel, [0.52, 0.16, 0.55], [0, 1.2, 3.05]);
    seat.rotation.x = -0.05;
    const back = addBox(group, mats.panel, [0.54, 0.66, 0.16], [0, 1.34, 2.84]);
    back.rotation.x = -0.16;
    addBox(group, mats.dark, [0.3, 0.16, 0.1], [0, 1.58, 2.8]);

    // Control stick and a left-console throttle quadrant.
    const stick = addBox(group, mats.dark, [0.07, 0.34, 0.09], [0, 1.16, 3.84], [0.18, 0, 0]);
    stick.userData.skipEdges = true;
    const grip = addBox(group, mats.dark, [0.09, 0.17, 0.13], [0, 1.35, 3.81], [0.18, 0, 0]);
    grip.userData.skipEdges = true;
    addBox(group, mats.dark, [0.09, 0.07, 0.38], [-0.43, 1.27, 3.36]).userData.skipEdges = true;
    addBox(group, mats.accent, [0.05, 0.09, 0.08], [-0.43, 1.34, 3.48]).userData.skipEdges = true;

    // Main instrument panel, turned toward the pilot (aft face, lower z).
    const panel = addBox(group, mats.dark, [0.94, 0.42, 0.14], [0, 1.16, 4.18], [-0.24, 0, 0]);
    panel.userData.skipEdges = true;
    addBox(group, mats.screen, [0.21, 0.14, 0.018], [-0.28, 1.23, 4.095], [-0.24, 0, 0]).userData.skipEdges = true;
    addBox(group, mats.screen, [0.21, 0.14, 0.018], [0, 1.23, 4.095], [-0.24, 0, 0]).userData.skipEdges = true;
    addBox(group, mats.screen, [0.21, 0.14, 0.018], [0.28, 1.23, 4.095], [-0.24, 0, 0]).userData.skipEdges = true;
    [-0.28, 0, 0.28].forEach((x) => {
      addBox(group, mats.dark, [0.15, 0.018, 0.006], [x, 1.27, 4.083], [-0.24, 0, 0]).userData.skipEdges = true;
      addBox(group, mats.accent, [0.11, 0.014, 0.006], [x, 1.19, 4.086], [-0.24, 0, 0]).userData.skipEdges = true;
    });
    [-0.36, -0.18, 0.18, 0.36].forEach((x, index) => {
      addBox(group, index % 2 ? mats.metal : mats.accent, [0.11, 0.09, 0.015], [x, 1.02, 4.115], [-0.24, 0, 0]).userData.skipEdges = true;
    });
    const glareshield = addBox(group, mats.dark, [0.98, 0.055, 0.2], [0, 1.39, 4.17], [-0.12, 0, 0]);
    glareshield.userData.skipEdges = true;

    // HUD combiner in the 3D cockpit; the game's flight symbology is the
    // DOM Aircraft HUD layered over this glass.
    const hudGlassMaterial = new THREE.MeshBasicMaterial({
      color: 0x9dffb0, transparent: true, opacity: 0.07,
      side: THREE.DoubleSide, depthWrite: false,
    });
    materials.add(hudGlassMaterial);
    allMaterials.add(hudGlassMaterial);
    const hudGlass = addBox(group, hudGlassMaterial, [0.3, 0.2, 0.012], [0, 1.56, 4.34], [-0.08, 0, 0]);
    hudGlass.userData.skipEdges = true;
    addBox(group, mats.dark, [0.025, 0.18, 0.025], [-0.14, 1.47, 4.32]).userData.skipEdges = true;
    addBox(group, mats.dark, [0.025, 0.18, 0.025], [0.14, 1.47, 4.32]).userData.skipEdges = true;

    const canopy = new THREE.Mesh(
      loft(
        [
          { z: 4.82, w: 0.25, h: 0.14, y: 1.13, exponent: 2.2 },
          { z: 4.5, w: 0.43, h: 0.34, y: 1.16, exponent: 2.2 },
          { z: 4.06, w: 0.53, h: 0.53, y: 1.19, exponent: 2.2 },
          { z: 3.48, w: 0.55, h: 0.58, y: 1.2, exponent: 2.2 },
          { z: 2.9, w: 0.51, h: 0.5, y: 1.18, exponent: 2.2 },
          { z: 2.46, w: 0.42, h: 0.3, y: 1.13, exponent: 2.2 },
          { z: 2.22, w: 0.28, h: 0.13, y: 1.09, exponent: 2.2 },
        ],
        28
      ),
      mats.glass
    );
    canopy.userData.skipEdges = false;
    canopy.name = "canopy-glass";
    canopyGlass = canopy;
    // Rear-hinged movable canopy: glass geometry is authored in airframe
    // coordinates, so offset it inside a hinge pivot at the aft sill.
    canopyPivot = new THREE.Group();
    canopyPivot.name = "canopy-pivot";
    canopyPivot.position.set(0, 1.22, 2.35);
    group.add(canopyPivot);
    canopy.position.set(0, -1.22, -2.35);
    canopyPivot.add(canopy);

    // canopy frame rails and bows (children of the moving pivot)
    const railGeo = new THREE.BoxGeometry(0.035, 0.045, 1.9);
    const railRight = new THREE.Mesh(railGeo, mats.dark);
    railRight.position.set(0.5, 0.01, 1.1);
    canopyPivot.add(railRight);
    const railLeft = railRight.clone();
    railLeft.position.x = -0.5;
    canopyPivot.add(railLeft);

    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.016, 6, 22, Math.PI), mats.dark);
    // TorusGeometry's half arc is already the upper half in XY; rotating it
    // by PI (as in the source pack) put both bows below the cockpit sill.
    bow.position.set(0, -0.02, 1.71);
    canopyPivot.add(bow);

    const frontBow = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.014, 6, 20, Math.PI), mats.dark);
    frontBow.position.set(0, -0.05, 2.15);
    canopyPivot.add(frontBow);

    const post = addBox(canopyPivot, mats.dark, [0.018, 0.36, 0.035], [0, 0.2, 2.0], [-0.45, 0, 0]);
    post.userData.skipEdges = true;

    markPart(group, "canopy", [0, 1.0, 0.25], materials);
  };

  /* ------------------------------ wings ------------------------------ */

  const makeWingGeometry = (): THREE.BufferGeometry => {
    const shape = new THREE.Shape();
    shape.moveTo(0.96, -2.08);
    shape.lineTo(7.3, -1.42);
    shape.quadraticCurveTo(8.58, -1.2, 8.8, -0.66);
    shape.quadraticCurveTo(8.88, -0.4, 8.58, -0.26);
    shape.lineTo(7.06, 0.22);
    shape.quadraticCurveTo(3.85, 0.6, 0.99, 0.76);
    shape.lineTo(0.96, -2.08);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.2,
      bevelEnabled: true,
      bevelSegments: 3,
      bevelSize: 0.08,
      bevelThickness: 0.05,
      steps: 1,
      curveSegments: 14,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -0.125, 0);
    geometry.computeVertexNormals();
    return geometry;
  };

  const buildWing = (side: "port" | "starboard"): void => {
    const group = new THREE.Group();
    const mats = makeMaterials();
    const materials = new Set<THREE.Material>();
    const rightGeometry = makeWingGeometry();
    const geometry = side === "port" ? mirrorGeometryX(rightGeometry) : rightGeometry;
    rightGeometry.dispose();

    const wing = new THREE.Mesh(geometry, mats.body);
    group.add(wing);

    // trailing-edge flaps in a darker shade
    const flapX = side === "port" ? -1 : 1;
    const flap = addBox(
      group,
      mats.panel,
      [3.9, 0.07, 0.42],
      [flapX * 3.35, -0.03, -0.32],
      [0.03, 0, flapX * 0.015]
    );
    flap.userData.skipEdges = true;

    const aileron = addBox(
      group,
      mats.panel,
      [1.7, 0.06, 0.32],
      [flapX * 6.55, -0.015, -0.16],
      [0.02, 0, flapX * 0.02]
    );
    aileron.userData.skipEdges = true;

    // panel seams and walkway strips on the upper surface
    const seam = new THREE.MeshStandardMaterial({
      color: 0x59624f,
      metalness: 0.34,
      roughness: 0.64,
    });
    materials.add(seam);
    allMaterials.add(seam);
    [0.1, -0.72, -1.42].forEach((z) => {
      const line = addBox(group, seam, [6.2, 0.008, 0.018], [flapX * 4.1, 0.108, z], [0, 0, flapX * 0.009]);
      line.userData.skipEdges = true;
    });
    const walk = addBox(group, seam, [1.5, 0.008, 0.34], [flapX * 2.35, 0.112, -0.35]);
    walk.userData.skipEdges = true;
    const hatch = addBox(group, mats.panel, [0.62, 0.018, 0.92], [flapX * 5.0, 0.108, -0.5]);
    hatch.userData.skipEdges = true;
    const insignia = new THREE.Mesh(
      new THREE.PlaneGeometry(1.95, 1.95),
      new THREE.MeshBasicMaterial({
        map: makeInsigniaTexture(),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
      })
    );
    insignia.rotation.x = -Math.PI / 2;
    insignia.position.set(flapX * 5.4, 0.114, 0.12);
    insignia.material.side = THREE.DoubleSide;
    group.add(insignia);

    // wingtip fairing and navigation light
    const tipPod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.19, 1.15, 16),
      mats.panel
    );
    tipPod.rotation.x = Math.PI / 2;
    tipPod.position.set(flapX * 8.64, 0.015, 0.06);
    group.add(tipPod);

    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 10, 8),
      new THREE.MeshBasicMaterial({ color: side === "port" ? 0xe26c4c : 0x9fcf68 })
    );
    lamp.position.set(flapX * 8.66, 0.02, 0.66);
    group.add(lamp);

    // hardpoint ribs (stores themselves are a separate assembly)
    [2.35, 3.95, 5.55].forEach((x) => {
      addBox(group, mats.panel, [0.34, 0.1, 1.0], [flapX * x, -0.16, 0.36]);
    });

    group.rotation.z = flapX * -0.022;
    group.position.y = -0.16;
    markPart(group, side === "port" ? "wing-port" : "wing-starboard", [flapX * 3.2, 0.5, 0.2], materials, group.position.clone());
    group.rotation.z = flapX * -0.022;
  };

  /* ----------------------------- engines ----------------------------- */

  const buildEngine = (side: "port" | "starboard"): void => {
    const group = new THREE.Group();
    const mats = makeMaterials();
    const materials = new Set<THREE.Material>();
    const sign = side === "port" ? -1 : 1;

    const nacelle = new THREE.Mesh(
      loft(
        [
          { z: 0.3, w: 0.63, h: 0.62, y: 0, exponent: 2.05 },
          { z: 0.02, w: 0.68, h: 0.67, y: 0, exponent: 2.05 },
          { z: -0.55, w: 0.72, h: 0.7, y: 0, exponent: 2.05 },
          { z: -1.6, w: 0.72, h: 0.7, y: 0, exponent: 2.05 },
          { z: -2.55, w: 0.66, h: 0.64, y: 0.01, exponent: 2.05 },
          { z: -3.24, w: 0.55, h: 0.54, y: 0.02, exponent: 2.05 },
          { z: -3.62, w: 0.49, h: 0.48, y: 0.02, exponent: 2.05 },
        ],
        30
      ),
      mats.body
    );
    group.add(nacelle);

    // intake lip and dark inlet duct
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.645, 0.062, 10, 34), mats.metal);
    lip.position.z = 0.31;
    group.add(lip);

    const duct = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.57, 0.56, 28, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x252a25,
        metalness: 0.55,
        roughness: 0.62,
        side: THREE.DoubleSide,
      })
    );
    duct.rotation.x = Math.PI / 2;
    duct.position.z = 0.06;
    group.add(duct);

    const fan = new THREE.Group();
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.35, 16), mats.metal);
    spinner.rotation.x = -Math.PI / 2;
    spinner.position.z = 0.36;
    fan.add(spinner);
    for (let i = 0; i < 16; i += 1) {
      const blade = addBox(fan, mats.dark, [0.5, 0.055, 0.015], [0, 0, 0.24]);
      blade.position.x = Math.cos((i / 16) * TAU) * 0.28;
      blade.position.y = Math.sin((i / 16) * TAU) * 0.28;
      blade.rotation.z = (i / 16) * TAU;
    }
    group.add(fan);

    // service collar + exhaust nozzle
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.69, 0.026, 8, 34), mats.panel);
    collar.position.z = -0.88;
    group.add(collar);
    const collar2 = collar.clone();
    collar2.position.z = -2.26;
    group.add(collar2);

    const exhaust = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.35, 0.45, 24, 1, true),
      mats.dark
    );
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.z = -3.72;
    group.add(exhaust);
    const exhaustRim = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.045, 9, 28), mats.metal);
    exhaustRim.position.z = -3.9;
    group.add(exhaustRim);

    // pylon fairing to fuselage
    const pylon = addBox(group, mats.panel, [0.26, 1.08, 2.1], [-sign * 0.6, -0.81, -0.95]);
    pylon.rotation.z = sign * 0.16;
    group.add(pylon);

    // small access hatch and cooling vent detail
    addBox(group, mats.panel, [0.24, 0.4, 0.7], [sign * 0.54, 0.15, -1.25]);
    for (let i = 0; i < 4; i += 1) {
      addBox(group, mats.dark, [0.22, 0.02, 0.18], [sign * 0.25, 0.62, -0.5 - i * 0.24]);
    }
    addBox(group, mats.dark, [0.25, 0.06, 1.9], [sign * 0.4, -0.66, -2.15]);

    group.position.set(sign * 1.76, 1.16, -0.14);
    group.scale.setScalar(1.1);
    markPart(
      group,
      side === "port" ? "engine-port" : "engine-starboard",
      [sign * 2.1, 1.8, 0.2],
      materials,
      group.position.clone()
    );
  };

  /* --------------------------- empennage ---------------------------- */

  const buildEmpennage = (): void => {
    const group = new THREE.Group();
    const mats = makeMaterials();
    const materials = new Set<THREE.Material>();

    const finShape = new THREE.Shape();
    finShape.moveTo(5.4, 0.36);
    finShape.quadraticCurveTo(6.1, 1.8, 6.82, 2.58);
    finShape.quadraticCurveTo(7.26, 2.78, 7.72, 2.55);
    finShape.lineTo(7.74, 0.36);
    finShape.closePath();
    const finGeo = new THREE.ExtrudeGeometry(finShape, {
      depth: 0.16,
      bevelEnabled: true,
      bevelSize: 0.035,
      bevelThickness: 0.035,
      bevelSegments: 2,
      steps: 1,
      curveSegments: 12,
    });
    finGeo.rotateY(Math.PI / 2);
    finGeo.translate(-0.08, 0, 0);

    const finPort = new THREE.Mesh(finGeo, mats.body);
    finPort.position.x = -1.3;
    finPort.rotation.z = 0.075;
    group.add(finPort);

    const finStarboard = finPort.clone();
    finStarboard.position.x = 1.3;
    finStarboard.rotation.z = -0.075;
    finStarboard.scale.x = 1;
    group.add(finStarboard);

    // rudder cap detail
    const cap = addBox(group, mats.panel, [0.19, 0.08, 0.92], [-1.3, 2.48, -7.12], [0, 0, 0.075]);
    cap.userData.skipEdges = true;
    const cap2 = addBox(group, mats.panel, [0.19, 0.08, 0.92], [1.3, 2.48, -7.12], [0, 0, -0.075]);
    cap2.userData.skipEdges = true;

    // ventral strakes
    addBox(group, mats.panel, [0.08, 0.42, 0.9], [-1.2, -0.1, -6.15], [0.3, 0, 0]);
    addBox(group, mats.panel, [0.08, 0.42, 0.9], [1.2, -0.1, -6.15], [0.3, 0, 0]);

    // horizontal stabiliser
    const stabShape = new THREE.Shape();
    stabShape.moveTo(-2.75, 6.85);
    stabShape.lineTo(-1.9, 6.42);
    stabShape.quadraticCurveTo(-0.7, 6.16, 0, 6.15);
    stabShape.quadraticCurveTo(0.7, 6.16, 1.9, 6.42);
    stabShape.lineTo(2.75, 6.85);
    stabShape.lineTo(2.82, 7.3);
    stabShape.quadraticCurveTo(2.2, 7.54, 1.2, 7.64);
    stabShape.lineTo(-1.2, 7.64);
    stabShape.quadraticCurveTo(-2.2, 7.54, -2.82, 7.3);
    stabShape.closePath();
    const stabGeo = new THREE.ExtrudeGeometry(stabShape, {
      depth: 0.12,
      bevelEnabled: true,
      bevelSize: 0.04,
      bevelThickness: 0.03,
      bevelSegments: 2,
      steps: 1,
      curveSegments: 12,
    });
    stabGeo.rotateX(-Math.PI / 2);
    stabGeo.translate(0, -0.06, 0);
    const stab = new THREE.Mesh(stabGeo, mats.body);
    stab.position.y = 0.46;
    group.add(stab);

    // elevator seam
    addBox(group, mats.panel, [4.8, 0.045, 0.45], [0, 0.44, -7.56], [0.03, 0, 0]);

    // fin stencil
    const finDecal = new THREE.Mesh(
      new THREE.PlaneGeometry(0.58, 0.2),
      new THREE.MeshBasicMaterial({
        map: makeDecalTexture("MI", "81 TFW"),
        transparent: true,
        depthWrite: false,
      })
    );
    finDecal.rotation.y = Math.PI / 2;
    finDecal.position.set(1.39, 1.76, -7.1);
    finDecal.rotation.z = -0.075;
    group.add(finDecal);

    markPart(group, "empennage", [0, 1.0, -2.8], materials);
  };

  /* ------------------------------- gun ------------------------------- */

  const buildGun = (): void => {
    const group = new THREE.Group();
    const mats = makeMaterials();
    const materials = new Set<THREE.Material>();
    const gunMetal = new THREE.MeshStandardMaterial({
      color: 0x424941,
      metalness: 0.86,
      roughness: 0.35,
    });
    materials.add(gunMetal);
    allMaterials.add(gunMetal);

    const receiver = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.34, 2.15, 22),
      gunMetal
    );
    receiver.rotation.x = Math.PI / 2;
    receiver.position.set(0, -1.1, 6.3);
    group.add(receiver);

    const housing = addBox(group, mats.dark, [0.74, 0.5, 1.3], [0.02, -1.1, 5.55]);
    housing.rotation.x = 0.03;
    group.add(housing);

    const ammoDrum = new THREE.Mesh(
      new THREE.CylinderGeometry(0.33, 0.33, 0.26, 22),
      mats.panel
    );
    ammoDrum.rotation.z = Math.PI / 2;
    ammoDrum.position.set(-0.42, -0.94, 5.15);
    group.add(ammoDrum);

    for (let i = 0; i < 7; i += 1) {
      const angle = (i / 7) * TAU;
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.058, 3.15, 10),
        gunMetal
      );
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(
        Math.cos(angle) * 0.115,
        -1.1 + Math.sin(angle) * 0.115,
        7.72
      );
      group.add(barrel);
    }

    [7.4, 8.2, 8.92].forEach((z, index) => {
      const clamp = new THREE.Mesh(
        new THREE.TorusGeometry(index === 2 ? 0.195 : 0.18, 0.032, 8, 22),
        mats.dark
      );
      clamp.position.set(0, -1.1, z);
      group.add(clamp);
    });

    const muzzleMaterial = new THREE.MeshStandardMaterial({
      color: 0x20251f,
      metalness: 0.8,
      roughness: 0.42,
    });
    materials.add(muzzleMaterial);
    allMaterials.add(muzzleMaterial);
    const muzzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.19, 0.16, 20),
      muzzleMaterial
    );
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, -1.1, 9.18);
    group.add(muzzle);

    markPart(group, "gun", [0, -0.45, 2.5], materials);
  };

  /* --------------------------- landing gear -------------------------- */

  const buildGear = (): void => {
    const group = new THREE.Group();
    const mats = makeMaterials();
    const materials = new Set<THREE.Material>();

    // nose gear
    addStrut(group, mats.metal, new THREE.Vector3(0, -0.9, 5.35), new THREE.Vector3(0, -1.85, 5.1), 0.075);
    addStrut(group, mats.metal, new THREE.Vector3(0.16, -0.9, 5.2), new THREE.Vector3(0.16, -1.65, 5.3), 0.04);
    addWheel(group, mats.tyre, mats.panel, [0.2, -1.95, 5.05], 0.25, 0.1);
    addWheel(group, mats.tyre, mats.panel, [-0.2, -1.95, 5.05], 0.25, 0.1);
    addBox(group, mats.panel, [0.06, 0.5, 0.62], [-0.36, -1.3, 5.36], [0, 0, 0.25]);
    const noseDoor = addBox(group, mats.panel, [0.54, 0.04, 0.72], [0, -1.14, 5.72], [0.2, 0, 0]);
    noseDoor.userData.skipEdges = true;

    // main gear
    ([-1, 1] as const).forEach((side) => {
      const x = side * 2.12;
      addStrut(
        group,
        mats.metal,
        new THREE.Vector3(side * 0.7, -0.62, 0.72),
        new THREE.Vector3(x, -1.55, 0.46),
        0.096
      );
      addStrut(
        group,
        mats.metal,
        new THREE.Vector3(side * 1.1, -0.7, 0.1),
        new THREE.Vector3(side * 2.0, -1.42, 0.44),
        0.06
      );
      addWheel(group, mats.tyre, mats.panel, [x, -1.78, 0.48], 0.43, 0.15);
      addBox(group, mats.panel, [0.1, 0.55, 1.1], [x + side * 0.24, -1.24, 0.28], [0, 0, side * 0.12]);
      addBox(group, mats.accent, [0.13, 0.08, 0.13], [x, -1.2, 0.02]);
      const door = addBox(group, mats.panel, [0.75, 0.045, 1.1], [side * 1.35, -0.92, 0.5], [0, 0, side * 0.18]);
      door.userData.skipEdges = true;
    });

    // small brake lines
    addStrut(group, mats.dark, new THREE.Vector3(1.9, -1.35, 0.65), new THREE.Vector3(2.0, -1.7, 0.62), 0.016);
    addStrut(group, mats.dark, new THREE.Vector3(-1.9, -1.35, 0.65), new THREE.Vector3(-2.0, -1.7, 0.62), 0.016);

    markPart(group, "gear", [0, 0.1, 0.25], materials);
  };

  /* ------------------------------ stores ----------------------------- */

  const storesGroup = new THREE.Group();
  const storeMats = makeMaterials();
  const storesMaterials = new Set<THREE.Material>();
  markPart(
    storesGroup,
    "stores",
    [0, -2.7, 0.4],
    storesMaterials
  );

  const storePartMaterial = (): THREE.MeshStandardMaterial => {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x69705f,
      metalness: 0.28,
      roughness: 0.62,
    });
    storesMaterials.add(mat);
    allMaterials.add(mat);
    return mat;
  };

  const mk82Material = storePartMaterial();
  const maverickMaterial = new THREE.MeshStandardMaterial({
    color: 0xbfc4b6,
    metalness: 0.45,
    roughness: 0.42,
  });
  const rocketPodMaterial = new THREE.MeshStandardMaterial({
    color: 0x777d66,
    metalness: 0.3,
    roughness: 0.6,
  });
  const missileMaterial = new THREE.MeshStandardMaterial({
    color: 0xc3c7bb,
    metalness: 0.5,
    roughness: 0.38,
  });
  const tankMaterial = new THREE.MeshStandardMaterial({
    color: 0x626a5c,
    metalness: 0.36,
    roughness: 0.52,
  });
  [maverickMaterial, rocketPodMaterial, missileMaterial, tankMaterial].forEach((mat) => {
    storesMaterials.add(mat);
    allMaterials.add(mat);
  });

  const makePylon = (x: number, z = 0.48): void => {
    const pylon = addBox(storesGroup, storeMats.panel, [0.2, 0.36, 0.9], [x, -0.34, z], [0.03, 0, 0]);
    pylon.userData.skipEdges = true;
  };

  const makeBomb = (x: number, y = -0.95, z = 0.35): void => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 1.25, 16), mk82Material);
    body.rotation.x = Math.PI / 2;
    group.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.21, 0.48, 16), mk82Material);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.86;
    group.add(nose);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.11, 0.4, 16), mk82Material);
    tail.rotation.x = Math.PI / 2;
    tail.position.z = -0.8;
    group.add(tail);
    for (let i = 0; i < 4; i += 1) {
      const fin = addBox(group, mk82Material, [0.025, 0.19, 0.34], [0, 0, -0.9]);
      fin.position.x = Math.cos((i / 4) * TAU) * 0.15;
      fin.position.y = Math.sin((i / 4) * TAU) * 0.15;
      fin.rotation.z = (i / 4) * TAU;
      group.add(fin);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.02, 6, 18), storeMats.accent);
    band.position.z = 0.3;
    group.add(band);
    group.position.set(x, y, z);
    storesGroup.add(group);
  };

  const makeRocketPod = (x: number, y = -0.9): void => {
    const group = new THREE.Group();
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.7, 20), rocketPodMaterial);
    pod.rotation.x = Math.PI / 2;
    group.add(pod);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.25, 20), storeMats.dark);
    face.position.z = 0.86;
    group.add(face);
    for (let i = 0; i < 7; i += 1) {
      const angle = (i / 7) * TAU;
      const tube = new THREE.Mesh(new THREE.CircleGeometry(0.045, 8), storeMats.dark);
      tube.position.set(Math.cos(angle) * 0.14, Math.sin(angle) * 0.14, 0.87);
      group.add(tube);
    }
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.253, 0.025, 6, 20), storeMats.accent);
    stripe.position.z = 0.46;
    group.add(stripe);
    group.position.set(x, y, 0.35);
    storesGroup.add(group);
  };

  const makeMissile = (x: number, y = -0.16, z = 0.2, scale = 1): void => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.75, 14), missileMaterial);
    body.rotation.x = Math.PI / 2;
    group.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.32, 14), missileMaterial);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 1.03;
    group.add(nose);
    const seeker = new THREE.Mesh(new THREE.SphereGeometry(0.088, 12, 10, 0, TAU, 0, Math.PI / 2), storeMats.dark);
    seeker.rotation.x = -Math.PI / 2;
    seeker.position.z = 0.9;
    group.add(seeker);
    for (let i = 0; i < 4; i += 1) {
      const fin = addBox(group, missileMaterial, [0.02, 0.17, 0.25], [0, 0, -0.7]);
      fin.position.x = Math.cos((i / 4) * TAU) * 0.13;
      fin.position.y = Math.sin((i / 4) * TAU) * 0.13;
      fin.rotation.z = (i / 4) * TAU;
      group.add(fin);
    }
    group.position.set(x, y, z);
    group.scale.setScalar(scale);
    storesGroup.add(group);
  };

  const makeMaverick = (x: number, y = -1.0): void => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.45, 16), maverickMaterial);
    body.rotation.x = Math.PI / 2;
    group.add(body);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), storeMats.glass);
    nose.position.z = 0.72;
    group.add(nose);
    for (let i = 0; i < 4; i += 1) {
      const fin = addBox(group, maverickMaterial, [0.02, 0.22, 0.28], [0, 0, -0.58]);
      fin.position.x = Math.cos((i / 4) * TAU + Math.PI / 4) * 0.16;
      fin.position.y = Math.sin((i / 4) * TAU + Math.PI / 4) * 0.16;
      fin.rotation.z = (i / 4) * TAU + Math.PI / 4;
      group.add(fin);
    }
    group.position.set(x, y, 0.4);
    storesGroup.add(group);
  };

  const makeFuelTank = (x: number, y = -1.12): void => {
    const tankGeo = new THREE.CylinderGeometry(0.3, 0.3, 2.25, 20);
    const tank = new THREE.Mesh(tankGeo, tankMaterial);
    tank.rotation.x = Math.PI / 2;
    tank.position.set(x, y, 0.35);
    storesGroup.add(tank);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 12), tankMaterial);
    nose.scale.z = 1.9;
    nose.position.set(x, y, 1.47);
    storesGroup.add(nose);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.1, 18), tankMaterial);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(x, y, -1.34);
    storesGroup.add(tail);
    for (let i = 0; i < 3; i += 1) {
      const fin = addBox(storesGroup, tankMaterial, [0.025, 0.3, 0.48], [x, y, -1.6]);
      fin.position.x = x + Math.cos((i / 3) * TAU) * 0.19;
      fin.position.y = y + Math.sin((i / 3) * TAU) * 0.19;
      fin.rotation.z = (i / 3) * TAU;
    }
  };

  const makeTargetingPod = (x: number): void => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.3, 18), storeMats.dark);
    body.rotation.x = Math.PI / 2;
    group.add(body);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), storeMats.glass);
    ball.position.z = 0.6;
    group.add(ball);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.025, 8, 24), storeMats.metal);
    collar.position.z = 0.42;
    group.add(collar);
    group.position.set(x, -1.0, 0.5);
    storesGroup.add(group);
  };

  const clearStores = (): void => {
    for (const child of [...storesGroup.children]) {
      storesGroup.remove(child);
      child.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
        }
      });
    }
  };

  let loadout: LoadoutId = initialLoadout;
  const rebuildStores = (): void => {
    clearStores();
    if (loadout === "clean") return;
    makePylon(-8.62, 0.08);
    makePylon(8.62, 0.08);
    makeMissile(-8.62, -0.16, 0.16);
    makeMissile(8.62, -0.16, 0.16);

    if (loadout === "standard") {
      makePylon(-2.35);
      makePylon(2.35);
      makePylon(-3.95);
      makePylon(3.95);
      makePylon(-5.55);
      makePylon(5.55);
      makeRocketPod(-3.95);
      makeRocketPod(3.95);
      makeBomb(-5.55);
      makeBomb(5.55);
      makeTargetingPod(2.35);
    } else {
      makePylon(-2.35);
      makePylon(2.35);
      makePylon(-3.95);
      makePylon(3.95);
      makePylon(-5.55);
      makePylon(5.55);
      makeMaverick(-3.95);
      makeMaverick(3.95);
      makeFuelTank(-2.35);
      makeFuelTank(2.35);
      makeBomb(-5.55);
      makeBomb(5.55);
      makeBomb(-5.55, -1.05, 0.9);
      makeBomb(5.55, -1.05, 0.9);
      makeTargetingPod(2.35);
    }
  };

  const rebuildEdgesForStores = (): void => {
    storesGroup.traverse((object) => {
      if (object instanceof THREE.Mesh && !matIsTransparentMap(object) && !object.userData.skipEdges) {
        const already = object.children.some((child) => child instanceof THREE.LineSegments);
        if (!already) {
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(object.geometry, 32),
            edgeMaterial
          );
          edges.visible = blueprint;
          edges.userData.partId = "stores";
          object.add(edges);
          edgeLines.push(edges);
        }
      }
    });
  };

  /* --------------------------- build parts --------------------------- */

  buildFuselage();
  buildCanopy();
  buildWing("port");
  buildWing("starboard");
  buildEngine("port");
  buildEngine("starboard");
  buildEmpennage();
  buildGun();
  buildGear();
  rebuildStores();
  rebuildEdgesForStores();
  applyExplosion();

  const highlightable = (material: THREE.Material): material is THREE.MeshStandardMaterial =>
    "emissive" in material && !material.userData.noHighlight;

  const setLivery = (id: LiveryId) => {
    palette = LIVERY_PRESETS.find((item) => item.id === id) ?? LIVERY_PRESETS[0];
    liveryMaterials.body.forEach((mat) => {
      mat.color.set(palette.body);
      mat.needsUpdate = true;
    });
    liveryMaterials.panel.forEach((mat) => {
      mat.color.set(palette.panel);
      mat.needsUpdate = true;
    });
    liveryMaterials.accent.forEach((mat) => {
      mat.color.set(palette.accent);
      mat.needsUpdate = true;
    });
    liveryMaterials.dark.forEach((mat) => {
      mat.color.set(palette.dark);
      mat.needsUpdate = true;
    });
  };

  const setLoadout = (id: LoadoutId) => {
    loadout = id;
    rebuildStores();
    rebuildEdgesForStores();
  };

  const setExplode = (amount: number) => {
    exploded = THREE.MathUtils.clamp(amount, 0, 1);
    applyExplosion();
  };

  const setCanopyOpen = (amount: number) => {
    canopyOpenAmount = Math.min(1, Math.max(0, amount));
    if (!canopyPivot) return;
    // Ease the glass/frame around its aft hinge; the slight lift prevents
    // the rails intersecting the cockpit sill at the start of travel.
    canopyPivot.rotation.x = -0.62 * canopyOpenAmount;
    canopyPivot.position.y = 1.22 + 0.055 * canopyOpenAmount;
  };

  const setCockpitView = (enabled: boolean) => {
    if (canopyGlass) canopyGlass.visible = !enabled;
  };

  const setGearDown = (down: boolean) => {
    const gear = parts.get("gear");
    if (gear) gear.group.visible = down;
  };

  const setBlueprint = (enabled: boolean) => {
    blueprint = enabled;
    allMaterials.forEach((material) => {
      const mat = material as THREE.MeshStandardMaterial;
      if (mat.userData.solidOpacity === undefined) {
        mat.userData.solidOpacity = mat.opacity;
        mat.userData.solidTransparent = mat.transparent;
        mat.userData.solidDepthWrite = mat.depthWrite;
      }
      if (mat === storeMats.glass) return;
      if (enabled) {
        mat.transparent = true;
        mat.opacity = Math.min(mat.userData.solidOpacity, 0.085);
        mat.depthWrite = false;
        mat.needsUpdate = true;
      } else {
        mat.transparent = mat.userData.solidTransparent as boolean;
        mat.opacity = mat.userData.solidOpacity as number;
        mat.depthWrite = mat.userData.solidDepthWrite as boolean;
        mat.needsUpdate = true;
      }
    });
    edgeLines.forEach((line) => {
      line.visible = enabled;
    });
  };

  const setSolo = (id: string | null) => {
    parts.forEach((part) => {
      part.group.visible = !id || part.spec.id === id;
    });
  };

  const setHighlight = (id: string | null, strength: number) => {
    if (!id) return;
    const part = parts.get(id);
    if (!part) return;
    part.materials.forEach((material) => {
      if (highlightable(material)) {
        material.emissive.set(strength > 0 ? 0xcfe879 : 0x000000);
        material.emissiveIntensity = strength;
      }
    });
  };

  const getStats = () => {
    let meshes = 0;
    let triangles = 0;
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        meshes += 1;
        const geometry = object.geometry;
        if (geometry.index) triangles += geometry.index.count / 3;
        else if (geometry.attributes.position) triangles += geometry.attributes.position.count / 3;
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
    allMaterials.forEach((mat) => {
      const map = (mat as THREE.MeshBasicMaterial).map;
      if (map) map.dispose();
      mat.dispose();
    });
    edgeMaterial.dispose();
    storesGroup.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
  };

  return {
    root,
    parts,
    partSpecs: PART_SPECS,
    setLivery,
    setLoadout,
    setExplode,
    setBlueprint,
    setHighlight,
    setSolo,
    setCanopyOpen,
    setCockpitView,
    setGearDown,
    getStats,
    dispose,
  };
}
