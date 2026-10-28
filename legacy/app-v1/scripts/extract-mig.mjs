/*
 * Reproducible extraction + revision of reference/mig29-fulcrum-09.html.
 *
 * The vendor file is a 4,160-line showcase (CDN importmap, PBR materials,
 * EffectComposer/bloom, showroom, drones, scripted sortie, DOM UI). This
 * script keeps ONLY the procedural airframe and its geometry/texture
 * helpers, drops ~70% of the file, and revises the material set from
 * MeshStandard/Physical + PMREM to mobile-friendly Lambert/Basic materials.
 *
 * Run: node scripts/extract-mig.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const html = readFileSync("reference/mig29-fulcrum-09.html", "utf8");
const mod = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];

/** Extract a top-level `function name(...) { ... }` block via brace matching. */
function extractFunction(source, name) {
  const sig = `function ${name}(`;
  const start = source.indexOf(sig);
  if (start < 0) throw new Error(`function ${name} not found`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let i = open;
  let inLine = false;
  let inBlock = false;
  let inStr = null;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (inLine) {
      if (c === "\n") inLine = false;
    } else if (inBlock) {
      if (c === "*" && n === "/") {
        inBlock = false;
        i++;
      }
    } else if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
    } else if (c === "/" && n === "/") {
      inLine = true;
      i++;
    } else if (c === "/" && n === "*") {
      inBlock = true;
      i++;
    } else if (c === '"' || c === "'" || c === "`") {
      inStr = c;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
    i++;
  }
  throw new Error(`unbalanced braces in ${name}`);
}

function extractConst(source, name) {
  const sig = `const ${name} =`;
  const start = source.indexOf(sig);
  if (start < 0) throw new Error(`const ${name} not found`);
  const semi = source.indexOf(";", start);
  return source.slice(start, semi + 1);
}

const dedent = (code) =>
  code
    .split("\n")
    .map((l) => l.replace(/^ {4}/, ""))
    .join("\n")
    .trim();

const coreFns = [
  "mulberry32",
  "makeCamoTexture",
  "makeInsigniaTexture",
  "makeNumberTexture",
  "superEllipsePoint",
  "makeLoft",
  "plateGeometry",
  "addTube",
  "meshOf",
];
const airframeFns = [
  "verticalPlateGeometry",
  "createMissile",
  "makeGearAssembly",
  "strutsSafeY",
  "buildMiG29",
  "buildCockpit",
  "buildCanopy",
];

const slices = [
  extractConst(mod, "TAU"),
  ...coreFns.map((f) => extractFunction(mod, f)),
  extractConst(mod, "AIRCRAFT"),
  ...airframeFns.map((f) => extractFunction(mod, f)),
].map(dedent);

/*
 * Revised material layer: same color identity as the vendor PBR set, rebuilt
 * on Lambert (lit) / Basic (emissive/decals) so no PMREM env map, composer or
 * bloom pass is required. Canvas textures stay lazy for headless imports.
 */
const materialsLayer = `
/* ----------------------- revised mobile material set ---------------------- */
let _camo, _insignia, _number;
const camoTex = () => (_camo ??= makeCamoTexture());
const insigniaTex = () => (_insignia ??= makeInsigniaTexture());
const numberTex = () => (_number ??= makeNumberTexture());

const lambert = (color, extra = {}) =>
  new THREE.MeshLambertMaterial({ color, ...extra });

function createMaterials() {
  const hull = lambert(0xf0f4ef, { map: camoTex() });
  return {
    hull,
    hullPlain: lambert(0x8f9c9d),
    hullLight: lambert(0xb4bdbb),
    hullDark: lambert(0x637173),
    metal: lambert(0x333c3e),
    darkMetal: lambert(0x141b1d),
    radome: lambert(0x586466),
    rubber: lambert(0x121617),
    cockpit: lambert(0x0b1011, { side: THREE.DoubleSide }),
    seat: lambert(0x2b302d),
    seatPad: lambert(0x4b4034),
    accent: lambert(0xbd3628),
    // Clearcoat physical glass -> cheap transparent Lambert.
    glass: lambert(0x1b3c43, {
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    screen: new THREE.MeshBasicMaterial({ color: 0x79d5bb, transparent: true, opacity: 0.8 }),
    hudGlass: new THREE.MeshBasicMaterial({
      color: 0x7fd4bd,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    star: new THREE.MeshBasicMaterial({
      map: insigniaTex(),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
    number: new THREE.MeshBasicMaterial({
      map: numberTex(),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
    flameOuter: new THREE.MeshBasicMaterial({
      color: 0xff7d3f,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
    flameInner: new THREE.MeshBasicMaterial({
      color: 0xa8e4ff,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
    navRed: new THREE.MeshBasicMaterial({ color: 0xff402f, toneMapped: false }),
    navGreen: new THREE.MeshBasicMaterial({ color: 0x88ffb4, toneMapped: false }),
    navWhite: new THREE.MeshBasicMaterial({ color: 0xfff4dc, toneMapped: false }),
    missileNose: lambert(0xc9c9be),
    missileBand: lambert(0x3f4a4c),
  };
}
`;

const header = `/*
 * VENDORED + REVISED MODULE — generated by scripts/extract-mig.mjs from
 * reference/mig29-fulcrum-09.html. Do not edit by hand; change the source
 * reference and rerun the extractor. @ts-nocheck: untyped vendor port.
 *
 * Revisions vs. the showcase original:
 *  - airframe + geometry/texture helpers only (showroom, drones, scripted
 *    sortie, bloom composer, DOM UI and all CDN imports removed)
 *  - PBR MeshStandard/Physical materials -> Lambert/Basic (no env map needed)
 *  - canvas textures are lazy singletons so headless imports need no DOM
 */
// @ts-nocheck
import * as THREE from "three";

`;

const footer = `
/* -------------------------------- public API ------------------------------- */
export function assembleMig29() {
  return buildMiG29(createMaterials());
}
export { AIRCRAFT };
`;

const out = header + slices.join("\n\n") + "\n" + materialsLayer + footer;
mkdirSync("game/vehicles", { recursive: true });
writeFileSync("game/vehicles/mig29.ts", out);
console.log(`wrote game/vehicles/mig29.ts (${out.split("\n").length} lines, ${out.length} bytes)`);
