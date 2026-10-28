/*
 * PROCEDURAL TEXTURE FORGE
 * ------------------------------------------------------------------
 * Every surface in the game is generated on a 2D canvas at startup —
 * no downloaded image assets, so the APK works fully offline.
 *
 * Technique ported and re-authored from SANDLINE (MIT, Copyright (c)
 * 2026 SANDLINE contributors, src/render/materials.ts): deterministic
 * LCG noise, hand-painted canvas atlases (brick, corrugated steel,
 * woven cloth, rain/grime decals, signage), seamless repeat wrapping.
 * See NOTICE.md for the attribution notice.
 */

import * as THREE from "three";

/** Deterministic LCG — same seed always yields the identical texture. */
export class ForgeRng {
  private state: number;
  constructor(seed = 982371) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
}

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return [canvas, ctx];
}

function toTexture(canvas: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  return map;
}

/** Packed laterite road / courtyard ground with gravel flecks and tire wear. */
function groundCanvas(rng: ForgeRng): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = "#8a6f4d";
  ctx.fillRect(0, 0, 512, 512);
  // Broad mottling first so the surface reads as packed earth, not noise.
  for (let i = 0; i < 90; i++) {
    const x = rng.range(0, 512);
    const y = rng.range(0, 512);
    const r = rng.range(18, 70);
    ctx.fillStyle = rng.next() < 0.5 ? "rgba(120,92,60,.10)" : "rgba(214,188,146,.08)";
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * rng.range(0.5, 1.1), rng.range(0, Math.PI), 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 9000; i++) {
    const shade = rng.next();
    ctx.fillStyle =
      shade < 0.45
        ? `rgba(74,55,34,${rng.range(0.08, 0.3)})`
        : `rgba(226,205,165,${rng.range(0.06, 0.22)})`;
    const s = rng.range(0.6, 2.4);
    ctx.fillRect(rng.range(0, 512), rng.range(0, 512), s, s);
  }
  // Fading tire lanes.
  for (const x of [150, 362]) {
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, "rgba(52,40,26,0)");
    grad.addColorStop(0.5, "rgba(52,40,26,.18)");
    grad.addColorStop(1, "rgba(52,40,26,0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x - 14, 170, x + 10, 340, x, 512);
    ctx.stroke();
  }
  return c;
}

/** Exposed clay masonry with staggered courses and weathered faces. */
function brickCanvas(rng: ForgeRng): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = "#9a8f7c";
  ctx.fillRect(0, 0, 512, 512);
  const palette = ["#a57f60", "#b08d6a", "#baa081", "#96775a", "#b69875"];
  for (let row = 0; row < 8; row++) {
    for (let col = -1; col < 5; col++) {
      const x = col * 128 + (row % 2) * 64;
      const y = row * 64;
      ctx.fillStyle = rng.pick(palette);
      ctx.fillRect(x + 3, y + 3, 122, 57);
      ctx.fillStyle = "rgba(230,213,179,.19)";
      ctx.fillRect(x + 4, y + 4, 120, 3);
      ctx.fillStyle = "rgba(59,46,30,.16)";
      ctx.fillRect(x + 4, y + 54, 120, 5);
    }
  }
  for (let i = 0; i < 22000; i++) {
    ctx.fillStyle = rng.next() > 0.5 ? "rgba(51,39,23,.12)" : "rgba(233,221,193,.14)";
    ctx.fillRect(rng.range(0, 512), rng.range(0, 512), 1 + rng.range(0, 3), 1 + rng.range(0, 2));
  }
  return c;
}

/** Corrugated steel siding with rust blooms along the lower edge. */
function corrugatedCanvas(rng: ForgeRng): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = "#a5afac";
  ctx.fillRect(0, 0, 512, 512);
  for (let x = 0; x < 512; x += 32) {
    const grad = ctx.createLinearGradient(x, 0, x + 32, 0);
    grad.addColorStop(0, "#5b6966");
    grad.addColorStop(0.2, "#c0c7ba");
    grad.addColorStop(0.4, "#a8b3ac");
    grad.addColorStop(0.85, "#9aa7a0");
    grad.addColorStop(1, "#64736c");
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, 32, 512);
  }
  for (let i = 0; i < 5000; i++) {
    const y = rng.range(0, 512);
    const lower = Math.max(0, (y - 370) / 142);
    ctx.fillStyle =
      rng.next() < 0.28 + lower * 0.6
        ? `rgba(88,49,29,${0.06 + lower * 0.22})`
        : "rgba(227,222,197,.14)";
    ctx.fillRect(rng.range(0, 512), y, 1 + rng.range(0, 4), 1 + rng.range(0, 14));
  }
  ctx.fillStyle = "rgba(97,58,35,.25)";
  ctx.fillRect(0, 495, 512, 17);
  return c;
}

/** Woven awning cloth with weft bands and dusty creases. */
function clothCanvas(rng: ForgeRng): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = "#c9b98f";
  ctx.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 2) {
    ctx.fillStyle = x % 4 ? "#b8ad90" : "#e0d5b7";
    ctx.fillRect(x, 0, 1, 128);
  }
  for (let y = 0; y < 128; y += 2) {
    ctx.fillStyle = "rgba(66,57,41,.13)";
    ctx.fillRect(0, y, 128, 1);
  }
  for (let x = 0; x < 128; x += 32) {
    ctx.fillStyle = "rgba(82,90,73,.22)";
    ctx.fillRect(x, 0, 12, 128);
  }
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(60,50,34,${rng.range(0.04, 0.12)})`;
    ctx.fillRect(rng.range(0, 128), rng.range(0, 128), 1, 1);
  }
  return c;
}

/** Weathered plaster: warm wash with hairline cracks and rising damp. */
function plasterCanvas(rng: ForgeRng): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = "#d8c9ab";
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = rng.next() < 0.5 ? "rgba(150,128,96,.08)" : "rgba(240,230,205,.10)";
    ctx.beginPath();
    ctx.ellipse(rng.range(0, 512), rng.range(0, 512), rng.range(10, 55), rng.range(8, 40), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(47,42,32,.38)";
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 7; i++) {
    let x = rng.range(40, 472);
    let y = rng.range(10, 200);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let j = 0; j < 12; j++) {
      x += rng.range(-22, 22);
      y += rng.range(8, 24);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const damp = ctx.createLinearGradient(0, 360, 0, 512);
  damp.addColorStop(0, "rgba(74,62,42,0)");
  damp.addColorStop(1, "rgba(74,62,42,.22)");
  ctx.fillStyle = damp;
  ctx.fillRect(0, 360, 512, 152);
  return c;
}

/** 2x4 atlas of rain streaks, dust blooms, cracks and road grime decals. */
function grimeCanvas(rng: ForgeRng): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(1024, 512);
  ctx.clearRect(0, 0, 1024, 512);
  for (let type = 0; type < 4; type++) {
    const x0 = type * 256;
    if (type === 0) {
      // Vertical rain runs.
      for (let i = 0; i < 56; i++) {
        const x = x0 + 8 + rng.range(0, 240);
        const top = rng.range(0, 50);
        const h = 90 + rng.range(0, 380);
        const g = ctx.createLinearGradient(0, top, 0, top + h);
        g.addColorStop(0, "rgba(58,46,29,.20)");
        g.addColorStop(0.3, "rgba(54,47,33,.12)");
        g.addColorStop(1, "rgba(64,49,30,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x, top, 2 + rng.range(0, 10), h);
      }
    } else if (type === 1) {
      // Dust blooms.
      for (let i = 0; i < 420; i++) {
        const x = x0 + rng.range(0, 256);
        const y = rng.range(0, 512);
        const d = Math.hypot((x - x0 - 128) / 128, (y - 256) / 256);
        if (d > 1) continue;
        ctx.fillStyle = `rgba(187,151,98,${(0.035 + rng.range(0, 0.06)) * (1 - d)})`;
        ctx.beginPath();
        ctx.ellipse(x, y, 8 + rng.range(0, 34), 12 + rng.range(0, 26), rng.range(0, Math.PI), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (type === 2) {
      // Cracked plaster.
      ctx.strokeStyle = "rgba(47,42,32,.45)";
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        let x = x0 + 40 + rng.range(0, 176);
        let y = 20 + rng.range(0, 180);
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let j = 0; j < 12; j++) {
          x += rng.range(-12, 12);
          y += rng.range(8, 20);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } else {
      // Lower-row broad road wear.
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, 256, 512);
      ctx.clip();
      for (let i = 0; i < 1800; i++) {
        const x = x0 + rng.range(0, 256);
        const y = rng.range(0, 512);
        const strength = Math.pow(1 - y / 512, 3);
        ctx.fillStyle = `rgba(75,59,34,${strength * rng.range(0.03, 0.12)})`;
        ctx.fillRect(x, y, 1 + rng.range(0, 10), 1 + rng.range(0, 8));
      }
      ctx.restore();
    }
  }
  return c;
}

/** Hand-lettered depot signage atlas (4x2 cells). */
function signsCanvas(): HTMLCanvasElement {
  const labels: Array<[string, string, string]> = [
    ["GOLDEN LAND", "SUPPLY DEPOT 04", "#27434a"],
    ["RESTRICTED", "AUTHORIZED PERSONNEL", "#774831"],
    ["WEST COURT", "SERVICE LANE", "#344f5b"],
    ["EAST COURT", "KEEP CLEAR", "#795338"],
    ["MED STATION", "RELIEF POINT", "#44534b"],
    ["STORE 05", "CLOSED FOR TRANSIT", "#4e5c56"],
    ["WATER POINT", "FILTERED · SAFE", "#2f4a55"],
    ["SL / 0608", "FREIGHT · KEEP DRY", "#566050"],
  ];
  const [c, ctx] = makeCanvas(1024, 512);
  labels.forEach(([title, subtitle, bg], i) => {
    const x = (i % 4) * 256;
    const y = Math.floor(i / 4) * 256;
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, 256, 256);
    ctx.strokeStyle = "#acaa8e";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 12, y + 20, 232, 216);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#e1d5b1";
    ctx.font = `700 ${title.length > 10 ? 24 : 30}px monospace`;
    ctx.fillText(title, x + 128, y + 105, 221);
    ctx.font = "600 13px monospace";
    ctx.fillText(subtitle, x + 128, y + 160, 220);
    for (const dx of [20, 235])
      for (const dy of [29, 229]) {
        ctx.fillStyle = "#302f26";
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
  });
  return c;
}

export interface ForgeTextures {
  ground: THREE.CanvasTexture;
  brick: THREE.CanvasTexture;
  metal: THREE.CanvasTexture;
  cloth: THREE.CanvasTexture;
  plaster: THREE.CanvasTexture;
  grime: THREE.CanvasTexture;
  signs: THREE.CanvasTexture;
}

export function forgeTextures(seed = 19377): ForgeTextures {
  const rng = new ForgeRng(seed);
  return {
    ground: toTexture(groundCanvas(rng)),
    brick: toTexture(brickCanvas(rng)),
    metal: toTexture(corrugatedCanvas(rng)),
    cloth: toTexture(clothCanvas(rng)),
    plaster: toTexture(plasterCanvas(rng)),
    grime: toTexture(grimeCanvas(rng)),
    signs: toTexture(signsCanvas()),
  };
}
