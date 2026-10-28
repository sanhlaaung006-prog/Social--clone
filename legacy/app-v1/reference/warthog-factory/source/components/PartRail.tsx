import type { PartSpec } from "@/factory/warthog";
import { ChevronRight, Cube } from "@/components/Icons";
import type { SceneStats } from "@/factory/scene";

interface PartRailProps {
  parts: PartSpec[];
  selectedId: string;
  hoveredId: string | null;
  stats: SceneStats;
  onSelect: (id: string) => void;
}

const categoryTone: Record<string, string> = {
  Airframe: "bg-[#5d684f]",
  Wings: "bg-[#8b9a66]",
  Propulsion: "bg-[#b58f54]",
  Armament: "bg-[#b86c47]",
  Systems: "bg-[#66808a]",
  Undercarriage: "bg-[#817761]",
};

const compactNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

export function PartRail({ parts, selectedId, hoveredId, stats, onSelect }: PartRailProps) {
  return (
    <aside
      className="flex h-[500px] flex-col overflow-hidden border border-line bg-panel lg:h-[560px] xl:h-[592px]"
    >
      <div className="flex items-start justify-between border-b border-line px-4 pb-3.5 pt-4">
        <div>
          <p className="mono-label text-[9px] text-muted">Assembly index</p>
          <p className="mt-1 text-[13px] font-semibold tracking-[-0.01em] text-ink">
            Airframe components
          </p>
        </div>
        <span className="flex h-7 w-7 items-center justify-center border border-line bg-paper text-olive">
          <Cube className="h-3.5 w-3.5" />
        </span>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto py-[3px]">
        {parts.map((part, index) => {
          const active = part.id === selectedId;
          const hovered = part.id === hoveredId && !active;
          return (
            <button
              key={part.id}
              type="button"
              onClick={() => onSelect(part.id)}
              aria-pressed={active}
              className={`group relative flex w-full items-center gap-2.5 border-l-2 px-3 py-[6px] text-left transition-colors ${
                active
                  ? "border-lime bg-ink text-paper"
                  : hovered
                    ? "border-line-dark bg-panel-deep/70 text-ink"
                    : "border-transparent text-ink hover:bg-paper"
              }`}
            >
              <span
                className={`mono-label w-[25px] shrink-0 text-[8px] ${
                  active ? "text-lime" : "text-faint"
                }`}
              >
                {part.code}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-[12px] font-medium leading-tight ${
                    active ? "text-paper" : "text-ink"
                  }`}
                >
                  {part.name}
                </span>
                <span
                  className={`mono-label mt-1 flex items-center gap-1.5 text-[7px] leading-none ${
                    active ? "text-paper/50" : "text-faint"
                  }`}
                >
                  <span
                    className={`h-[3px] w-[3px] rounded-full ${categoryTone[part.category] ?? "bg-olive"}`}
                  />
                  {part.category}
                </span>
              </span>
              <span
                className={`mono-label text-[8px] ${active ? "text-paper/40" : "text-faint/70"}`}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <ChevronRight
                className={`h-3 w-3 shrink-0 transition-transform group-hover:translate-x-0.5 ${
                  active ? "text-lime" : "text-line-dark"
                }`}
              />
            </button>
          );
        })}
      </div>

      <div className="border-t border-line bg-paper/60 px-4 py-2.5">
        <div className="flex items-center justify-between">
          <span className="mono-label text-[9px] text-muted">Model integrity</span>
          <span className="mono-label flex items-center gap-1.5 text-[7px] text-[#647b35]">
            <span className="live-dot h-1 w-1 rounded-full bg-[#7e9b41]" />
            verified
          </span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <div>
            <p className="mono-label text-[7px] text-faint">Parts</p>
            <p className="mt-0.5 font-mono text-[13px] leading-none text-ink">
              {String(stats.parts).padStart(2, "0")}
            </p>
          </div>
          <div>
            <p className="mono-label text-[7px] text-faint">Triangles</p>
            <p className="mt-0.5 font-mono text-[13px] leading-none text-ink">
              {stats.triangles ? compactNumber(stats.triangles) : "—"}
            </p>
          </div>
          <div>
            <p className="mono-label text-[7px] text-faint">Materials</p>
            <p className="mt-0.5 font-mono text-[13px] leading-none text-ink">
              {stats.materials || "—"}
            </p>
          </div>
        </div>
        <div className="mt-2 flex h-1 gap-0.5" aria-hidden>
          {Array.from({ length: 18 }).map((_, index) => (
            <span
              key={index}
              className={`flex-1 ${index < 15 ? "bg-[#8b9a66]" : "bg-line"}`}
            />
          ))}
        </div>
        <p className="mono-label mt-1.5 text-[6.5px] normal-case leading-relaxed tracking-[0.04em] text-faint">
          Built in browser · 0 external mesh assets
        </p>
      </div>
    </aside>
  );
}
