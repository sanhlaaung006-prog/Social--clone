import { useEffect, useState } from "react";
import {
  LIVERY_PRESETS,
  WARTHOG_SPECS,
  type LiveryId,
  type LoadoutId,
  type PartSpec,
} from "@/factory/warthog";
import { LOADOUTS } from "@/factory/warthog";
import { AirframePlan } from "@/components/AirframePlan";
import { ChevronRight, Frame, Info, Isolate, Plus, Ruler } from "@/components/Icons";

interface InspectorProps {
  selected: PartSpec;
  soloId: string | null;
  units: "m" | "ft";
  livery: LiveryId;
  loadout: LoadoutId;
  onSelectPart: (id: string) => void;
  onUnitsChange: (units: "m" | "ft") => void;
  onLiveryChange: (livery: LiveryId) => void;
  onIsolate: (id: string) => void;
  onClearSolo: () => void;
  onFocus: (id: string) => void;
}

const number = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

const mass = (value: number, units: "m" | "ft") =>
  units === "m" ? `${number(value)} kg` : `${number(Math.round(value * 2.20462))} lb`;

const dimension = (value: number, units: "m" | "ft") =>
  units === "m" ? value.toFixed(2) : (value * 3.28084).toFixed(1);

function MetaRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <span className="mono-label shrink-0 pt-0.5 text-[8px] text-faint">{label}</span>
      <span
        className={`text-right text-[11px] leading-snug ${
          accent ? "font-medium text-ink" : "text-muted"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex-1 px-3 py-3 text-left transition-colors ${
        active ? "text-ink" : "text-muted hover:text-ink"
      }`}
    >
      <span className="mono-label text-[9px]">{children}</span>
      <span
        className={`absolute inset-x-0 bottom-0 h-[2px] ${active ? "bg-ink" : "bg-transparent"}`}
      />
    </button>
  );
}

export function Inspector({
  selected,
  soloId,
  units,
  livery,
  loadout,
  onSelectPart,
  onUnitsChange,
  onLiveryChange,
  onIsolate,
  onClearSolo,
  onFocus,
}: InspectorProps) {
  const [tab, setTab] = useState<"part" | "airframe">("part");
  const isSolo = soloId === selected.id;

  useEffect(() => {
    setTab("part");
  }, [selected.id]);
  const liverySpec = LIVERY_PRESETS.find((item) => item.id === livery) ?? LIVERY_PRESETS[0];
  const loadoutSpec = LOADOUTS.find((item) => item.id === loadout) ?? LOADOUTS[0];

  return (
    <aside
      id="reference"
      className="flex h-[560px] flex-col overflow-hidden border border-line bg-panel lg:h-[560px] xl:h-[592px]"
    >
      <div className="flex items-stretch border-b border-line">
        <TabButton active={tab === "part"} onClick={() => setTab("part")}>
          Part inspector
        </TabButton>
        <span className="my-3 w-px bg-line" />
        <TabButton active={tab === "airframe"} onClick={() => setTab("airframe")}>
          Airframe spec
        </TabButton>
        <div className="flex items-center border-l border-line px-2">
          <div className="flex border border-line bg-paper p-0.5" role="group" aria-label="Dimension units">
            {(["m", "ft"] as const).map((unit) => (
              <button
                key={unit}
                type="button"
                onClick={() => onUnitsChange(unit)}
                aria-pressed={units === unit}
                className={`mono-label px-1.5 py-1 text-[8px] transition-colors ${
                  units === unit ? "bg-ink text-lime" : "text-muted hover:text-ink"
                }`}
              >
                {unit}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        {tab === "part" ? (
          <div className="fade-rise px-4 pb-4 pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="mono-label bg-ink px-1.5 py-1 text-[8px] text-lime">
                  {selected.code}
                </span>
                <span className="mono-label text-[8px] text-muted">{selected.category}</span>
              </div>
              <span className="mono-label flex items-center gap-1 text-[7px] text-faint">
                <span className="h-1 w-1 rounded-full bg-[#82954f]" />
                live geometry
              </span>
            </div>
            <h2 className="mt-2 text-[25px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink">
              {selected.name}
            </h2>
            <p className="mt-2 text-[11px] leading-[1.6] text-muted">{selected.summary}</p>

            <div className="mt-3">
              <AirframePlan selectedId={selected.id} onSelect={onSelectPart} />
            </div>

            <div className="mt-3 grid grid-cols-3 border border-line bg-paper/55">
              {[
                { label: "Length", value: selected.dimensions[0] },
                { label: "Span", value: selected.dimensions[1] },
                { label: "Height", value: selected.dimensions[2] },
              ].map((item, index) => (
                <div
                  key={item.label}
                  className={`px-2.5 py-2 ${index < 2 ? "border-r border-line" : ""}`}
                >
                  <p className="mono-label text-[7px] text-faint">{item.label}</p>
                  <p className="mt-1 font-mono text-[15px] leading-none tracking-[-0.04em] text-ink">
                    {dimension(item.value, units)}
                    <span className="ml-0.5 text-[8px] tracking-normal text-faint">{units}</span>
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-3">
              <MetaRow label="Material" value={selected.material} accent />
              <MetaRow label="Mass" value={mass(selected.massKg, units)} />
              <MetaRow label="Code / station" value={`${selected.code} · ${selected.category}`} />
            </div>

            <div className="mt-3 border border-[#c8d598] bg-[#eef4d4] px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <Info className="h-3 w-3 text-[#5b6a33]" />
                <span className="mono-label text-[7px] text-[#5b6a33]">Reference note</span>
              </div>
              <p className="mt-1.5 text-[10px] leading-[1.6] text-[#4c5638]">{selected.note}</p>
            </div>

            <div className="mt-3 grid grid-cols-[1fr_auto] gap-1.5">
              <button
                type="button"
                onClick={() => (isSolo ? onClearSolo() : onIsolate(selected.id))}
                className={`flex items-center justify-center gap-1.5 px-2 py-2 text-[10px] font-medium transition-colors ${
                  isSolo
                    ? "border border-ink bg-lime text-ink hover:bg-[#e4f58d]"
                    : "border border-ink bg-ink text-paper hover:bg-olive"
                }`}
              >
                {isSolo ? <Plus className="h-3 w-3 rotate-45" /> : <Isolate className="h-3 w-3" />}
                {isSolo ? "Show full aircraft" : "Isolate part"}
              </button>
              <button
                type="button"
                onClick={() => onFocus(selected.id)}
                className="flex items-center justify-center gap-1.5 border border-line-dark bg-panel px-2.5 py-2 text-[10px] font-medium text-ink transition-colors hover:border-ink hover:bg-paper"
              >
                <Frame className="h-3 w-3" />
                Frame
              </button>
            </div>
          </div>
        ) : (
          <div className="fade-rise px-4 pb-4 pt-4">
            <div className="flex items-center gap-2">
              <span className="mono-label bg-ink px-1.5 py-1 text-[8px] text-lime">
                AIR-010
              </span>
              <span className="mono-label text-[8px] text-muted">A-10C reference datum</span>
            </div>
            <h2 className="mt-2 text-[25px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink">
              Thunderbolt II
            </h2>
            <p className="mt-2 text-[11px] leading-[1.6] text-muted">
              Single-seat, twin-engine close air support aircraft. This reference build
              favours recognisable factory geometry over manufacturing accuracy.
            </p>

            <div className="mt-3">
              <AirframePlan />
            </div>

            <div className="mt-3 grid grid-cols-2 border border-line bg-paper/55">
              {[
                { label: "Length", value: dimension(WARTHOG_SPECS.lengthM, units), unit: units },
                { label: "Wingspan", value: dimension(WARTHOG_SPECS.wingspanM, units), unit: units },
                { label: "Height", value: dimension(WARTHOG_SPECS.heightM, units), unit: units },
                {
                  label: "Empty mass",
                  value: number(WARTHOG_SPECS.emptyMassKg),
                  unit: "kg",
                },
              ].map((item, index) => (
                <div
                  key={item.label}
                  className={`px-3 py-2.5 ${
                    index % 2 === 0 ? "border-r border-line" : ""
                  } ${index < 2 ? "border-b border-line" : ""}`}
                >
                  <p className="mono-label text-[7px] text-faint">{item.label}</p>
                  <p className="mt-1 font-mono text-[17px] leading-none tracking-[-0.04em] text-ink">
                    {item.value}
                    <span className="ml-1 text-[8px] tracking-normal text-faint">{item.unit}</span>
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-3">
              <MetaRow label="Role" value={WARTHOG_SPECS.role} accent />
              <MetaRow label="Crew" value={WARTHOG_SPECS.crew} />
              <MetaRow label="Powerplant" value={WARTHOG_SPECS.engine} />
              <MetaRow label="Total thrust" value={`${WARTHOG_SPECS.thrustKN} kN`} />
              <MetaRow label="Maximum speed" value={`${number(WARTHOG_SPECS.maxSpeedKmh)} km/h`} />
              <MetaRow label="Combat radius" value={`${number(WARTHOG_SPECS.combatRadiusKm)} km`} />
              <MetaRow label="Primary gun" value={WARTHOG_SPECS.gun} />
              <MetaRow label="Feed" value={`${number(WARTHOG_SPECS.rounds)} rounds · ${number(WARTHOG_SPECS.gunRate)} rpm`} />
              <MetaRow label="First flight" value={`${WARTHOG_SPECS.firstFlight}`} />
            </div>

            <div className="mt-3 border border-line bg-paper px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="mono-label text-[7px] text-faint">Current configuration</span>
                <Ruler className="h-3 w-3 text-faint" />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted">Finish</span>
                <span className="text-[10px] font-medium text-ink">{liverySpec.label}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted">Mission stores</span>
                <span className="text-[10px] font-medium text-ink">
                  {loadoutSpec.label} · {loadoutSpec.count} stations
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setTab("part")}
              className="mt-3 flex w-full items-center justify-between border border-line px-2.5 py-2 text-[10px] text-ink transition-colors hover:bg-paper"
            >
              Back to component inspection
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-line bg-paper/70 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="mono-label text-[8px] text-muted">Factory finish</span>
          <span className="mono-label text-[8px] text-ink">{liverySpec.label}</span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1">
          {LIVERY_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onLiveryChange(preset.id)}
              aria-pressed={livery === preset.id}
              title={preset.label}
              aria-label={preset.label}
              className={`group flex flex-col items-center gap-1 border px-1 py-1.5 transition-colors ${
                livery === preset.id
                  ? "border-ink bg-panel"
                  : "border-transparent hover:border-line-dark hover:bg-panel"
              }`}
            >
              <span
                className="h-4 w-full border border-black/15"
                style={{ backgroundColor: preset.swatch }}
              />
              <span className="mono-label text-[6px] text-muted group-hover:text-ink">
                {preset.label.split(" ")[0]}
              </span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
