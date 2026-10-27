import factorySource from "@/factory/warthog.ts?raw";
import {
  LIVERY_PRESETS,
  LOADOUTS,
  PART_SPECS,
  WARTHOG_SPECS,
  type LiveryId,
  type LoadoutId,
} from "@/factory/warthog";

export { factorySource };

export interface ManifestOptions {
  livery: LiveryId;
  loadout: LoadoutId;
}

export function createManifest({ livery, loadout }: ManifestOptions) {
  const liverySpec = LIVERY_PRESETS.find((item) => item.id === livery) ?? LIVERY_PRESETS[0];
  const loadoutSpec = LOADOUTS.find((item) => item.id === loadout) ?? LOADOUTS[0];

  return {
    schema: "warthog-factory/airframe@1.0",
    generatedAt: new Date().toISOString(),
    referenceOnly: "Not affiliated with or endorsed by the United States Air Force.",
    airframe: {
      designation: WARTHOG_SPECS.designation,
      nickname: WARTHOG_SPECS.nickname,
      role: WARTHOG_SPECS.role,
      crew: WARTHOG_SPECS.crew,
      dimensions: {
        lengthM: WARTHOG_SPECS.lengthM,
        wingspanM: WARTHOG_SPECS.wingspanM,
        heightM: WARTHOG_SPECS.heightM,
        wingAreaM2: WARTHOG_SPECS.wingAreaM2,
      },
      mass: {
        emptyKg: WARTHOG_SPECS.emptyMassKg,
        maxTakeoffKg: WARTHOG_SPECS.maxMassKg,
      },
      propulsion: {
        engines: WARTHOG_SPECS.engine,
        totalThrustKN: WARTHOG_SPECS.thrustKN,
      },
      armament: {
        cannon: WARTHOG_SPECS.gun,
        rateOfFireRpm: WARTHOG_SPECS.gunRate,
        rounds: WARTHOG_SPECS.rounds,
      },
      performance: {
        maxSpeedKmh: WARTHOG_SPECS.maxSpeedKmh,
        combatRadiusKm: WARTHOG_SPECS.combatRadiusKm,
      },
      history: {
        firstFlight: WARTHOG_SPECS.firstFlight,
        unitsBuilt: WARTHOG_SPECS.unitsBuilt,
      },
    },
    configuration: {
      livery: { id: liverySpec.id, label: liverySpec.label },
      loadout: { id: loadoutSpec.id, label: loadoutSpec.label, storeCount: loadoutSpec.count },
    },
    coordinateSystem: {
      up: "+Y",
      forward: "+Z",
      right: "+X",
      units: "metres",
      origin: "fuselage datum",
    },
    parts: PART_SPECS.map((part) => ({
      code: part.code,
      id: part.id,
      name: part.name,
      category: part.category,
      material: part.material,
      massKg: part.massKg,
      dimensionsM: {
        length: part.dimensions[0],
        span: part.dimensions[1],
        height: part.dimensions[2],
      },
      summary: part.summary,
      note: part.note,
    })),
    generation: {
      library: "three.js",
      externalAssets: 0,
      primitives: ["superellipse loft", "extruded planform", "torus", "cylinder", "canvas stencil"],
      sourceFile: "warthog.factory.ts",
    },
  };
}

export function manifestJson(options: ManifestOptions): string {
  return `${JSON.stringify(createManifest(options), null, 2)}\n`;
}

const csvEscape = (value: string | number): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function partsCsv(): string {
  const rows = [
    ["code", "id", "name", "category", "material", "mass_kg", "length_m", "span_m", "height_m", "note"],
    ...PART_SPECS.map((part) => [
      part.code,
      part.id,
      part.name,
      part.category,
      part.material,
      part.massKg,
      part.dimensions[0],
      part.dimensions[1],
      part.dimensions[2],
      part.note,
    ]),
  ];
  return `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

export function downloadText(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export const downloadManifest = (options: ManifestOptions) =>
  downloadText("warthog-airframe.manifest.json", manifestJson(options), "application/json");

export const downloadCsv = () => downloadText("warthog-parts.csv", partsCsv(), "text/csv");

export const downloadSource = () =>
  downloadText("warthog.factory.ts", factorySource, "text/typescript");

export async function copySource(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(factorySource);
    return true;
  } catch {
    return false;
  }
}
