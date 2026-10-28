import { useRef } from "react";
import type { RefObject } from "react";
import {
  CAMERA_VIEWS,
  type ViewId,
} from "@/factory/scene";
import { LOADOUTS, type LoadoutId, type PartSpec } from "@/factory/warthog";
import {
  Blueprint,
  Camera,
  Close,
  Expand,
  Explode,
  Isolate,
  Orbit,
  Reset,
  Target,
} from "@/components/Icons";

interface ViewportProps {
  containerRef: RefObject<HTMLDivElement | null>;
  ready: boolean;
  error: string | null;
  selected: PartSpec;
  view: ViewId;
  autoRotate: boolean;
  blueprint: boolean;
  explode: number;
  loadout: LoadoutId;
  soloId: string | null;
  soloName?: string;
  onView: (view: ViewId) => void;
  onAutoRotate: () => void;
  onBlueprint: () => void;
  onScreenshot: () => void;
  onReset: () => void;
  onExplode: (value: number) => void;
  onLoadout: (loadout: LoadoutId) => void;
  onClearSolo: () => void;
}

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center border transition-colors ${
        active
          ? "border-lime bg-lime text-ink"
          : "border-white/15 bg-black/25 text-white/70 backdrop-blur-sm hover:border-white/35 hover:text-white"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

export function Viewport({
  containerRef,
  ready,
  error,
  selected,
  view,
  autoRotate,
  blueprint,
  explode,
  loadout,
  soloId,
  soloName,
  onView,
  onAutoRotate,
  onBlueprint,
  onScreenshot,
  onReset,
  onExplode,
  onLoadout,
  onClearSolo,
}: ViewportProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  const requestFullscreen = () => {
    const panel = panelRef.current;
    if (!panel) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void panel.requestFullscreen?.();
    }
  };

  return (
    <section
      ref={panelRef}
      className="scene-stage relative h-[500px] overflow-hidden border border-[#30362b] bg-viewport sm:h-[560px] lg:h-[560px] xl:h-[592px]"
      aria-label="Interactive aircraft viewport"
    >
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* corner framing */}
      <span className="corner-mark left-3 top-3 z-[5]" aria-hidden />
      <span className="corner-mark right-3 top-3 z-[5] rotate-90" aria-hidden />
      <span className="corner-mark bottom-3 left-3 z-[5] -rotate-90" aria-hidden />
      <span className="corner-mark bottom-3 right-3 z-[5] rotate-180" aria-hidden />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-3 sm:p-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 border border-white/12 bg-black/30 px-2.5 py-[7px] backdrop-blur-md">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-lime" />
            <span className="mono-label whitespace-nowrap text-[8px] text-white/85">
              {blueprint ? "Blueprint engine" : "WebGL assembly"}
            </span>
            <span className="hidden h-2.5 w-px bg-white/20 sm:block" />
            <span className="mono-label hidden text-[7px] text-white/40 sm:block">
              {blueprint ? "Line / 02" : "Live / 01"}
            </span>
          </div>
          <div className="flex items-center gap-2 px-0.5">
            <span className="mono-label whitespace-nowrap text-[7px] text-white/35">
              A-10C<span className="hidden sm:inline"> · THUNDERBOLT II</span>
            </span>
            <span className="h-px w-5 bg-white/20" />
            <span className="mono-label hidden text-[7px] text-white/25 sm:inline">REF / 01</span>
          </div>
          {soloId ? (
            <div className="pointer-events-auto flex items-center gap-2 border border-lime/50 bg-[#222b18]/90 px-2.5 py-1.5 backdrop-blur-md">
              <Isolate className="h-3 w-3 text-lime" />
              <span className="mono-label text-[7px] text-lime">
                Solo / {soloName ?? soloId}
              </span>
              <button
                type="button"
                onClick={onClearSolo}
                aria-label="Show all aircraft parts"
                className="ml-1 text-white/55 transition-colors hover:text-white"
              >
                <Close className="h-3 w-3" />
              </button>
            </div>
          ) : null}
        </div>

        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <div className="flex items-center gap-1">
            <ToolButton label={autoRotate ? "Stop turntable" : "Start turntable"} active={autoRotate} onClick={onAutoRotate}>
              <Orbit className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton label={blueprint ? "Exit blueprint mode" : "Blueprint mode"} active={blueprint} onClick={onBlueprint}>
              <Blueprint className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton label="Capture viewport as PNG" onClick={onScreenshot} disabled={!ready || Boolean(error)}>
              <Camera className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton label="Reset camera" onClick={onReset}>
              <Reset className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton label="Fullscreen viewport" onClick={requestFullscreen}>
              <Expand className="h-3.5 w-3.5" />
            </ToolButton>
          </div>
          <div className="hidden items-center gap-1.5 border border-white/10 bg-black/25 px-2 py-1 backdrop-blur-sm sm:flex">
            <Target className="h-2.5 w-2.5 text-lime/70" />
            <span className="mono-label text-[6px] text-white/45">Click a component to inspect</span>
          </div>
        </div>
      </div>

      {/* axis legend */}
      <div className="pointer-events-none absolute bottom-[92px] left-4 z-10 hidden items-center gap-2.5 text-white/35 md:flex">
        <svg width="54" height="34" viewBox="0 0 54 34" fill="none" aria-hidden>
          <path d="M27 29V7" stroke="#d5ec6e" strokeWidth="0.8" />
          <path d="m27 5 2.4 4h-4.8z" fill="#d5ec6e" />
          <path d="M27 29H9" stroke="#9ea78f" strokeWidth="0.8" />
          <path d="M27 29h18" stroke="#9ea78f" strokeWidth="0.8" />
          <path d="m7 29 4-2.2v4.4z" fill="#9ea78f" />
          <text x="31" y="8" fill="#d5ec6e" fontSize="5" fontFamily="monospace">Y</text>
          <text x="29" y="22" fill="#9ea78f" fontSize="5" fontFamily="monospace">+Z</text>
          <text x="42" y="24" fill="#9ea78f" fontSize="5" fontFamily="monospace">+X</text>
        </svg>
        <div>
          <p className="mono-label text-[6px] text-white/35">Datum / metres</p>
          <p className="mt-0.5 font-mono text-[8px] tracking-[0.06em] text-white/60">
            {selected.code} · {selected.name.toUpperCase()}
          </p>
        </div>
      </div>

      {/* render states */}
      {!ready && !error ? (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[#141810]/80">
          <span className="h-7 w-7 animate-spin rounded-full border border-white/20 border-t-lime" />
          <p className="mono-label text-[8px] text-white/60">Milling 3D geometry</p>
          <p className="mono-label text-[6px] text-white/25">10 assemblies / 0 external assets</p>
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-[#141810]/95 px-8 text-center">
          <Target className="h-6 w-6 text-lime/70" />
          <p className="mono-label text-[9px] text-white/80">WebGL unavailable</p>
          <p className="max-w-xs text-[11px] leading-relaxed text-white/40">{error}</p>
          <p className="mono-label mt-2 text-[6px] text-white/25">
            Try a WebGL2-capable browser with hardware acceleration enabled.
          </p>
        </div>
      ) : null}

      {/* bottom toolbar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-2.5 sm:p-3">
        <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-2 border border-white/12 bg-[#10140d]/88 px-2.5 py-2 shadow-[0_18px_50px_rgba(0,0,0,0.32)] backdrop-blur-md">
          <div className="flex items-center gap-1.5">
            <span className="mono-label mr-0.5 hidden text-[6px] text-white/30 sm:block">View</span>
            <div className="flex border border-white/12 p-0.5">
              {(Object.keys(CAMERA_VIEWS) as ViewId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onView(id)}
                  aria-pressed={view === id}
                  className={`mono-label px-1.5 py-1 text-[6.5px] transition-colors ${
                    view === id
                      ? "bg-lime text-ink"
                      : "text-white/45 hover:bg-white/8 hover:text-white/85"
                  }`}
                >
                  {CAMERA_VIEWS[id].label}
                </button>
              ))}
            </div>
          </div>

          <span className="hidden h-5 w-px bg-white/12 sm:block" />

          <div className="flex items-center gap-1.5">
            <span className="mono-label mr-0.5 hidden text-[6px] text-white/30 sm:block">Stores</span>
            <div className="flex border border-white/12 p-0.5">
              {LOADOUTS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onLoadout(option.id)}
                  aria-pressed={loadout === option.id}
                  className={`mono-label flex items-center gap-1 px-1.5 py-1 text-[6.5px] transition-colors ${
                    loadout === option.id
                      ? "bg-white/90 text-ink"
                      : "text-white/45 hover:bg-white/8 hover:text-white/85"
                  }`}
                >
                  {option.label}
                  <span
                    className={`h-1 w-1 rounded-full ${
                      option.count === 0 ? "bg-white/25" : "bg-lime"
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          <span className="hidden h-5 w-px bg-white/12 sm:block" />

          <div className="flex min-w-[130px] flex-1 items-center gap-2">
            <span className="mono-label flex shrink-0 items-center gap-1 text-[6px] text-white/30">
              <Explode className="h-2.5 w-2.5" />
              Explode
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(explode * 100)}
              onChange={(event) => onExplode(Number(event.target.value) / 100)}
              aria-label="Exploded assembly amount"
              className="factory-range min-w-0 flex-1"
              style={{
                background: `linear-gradient(to right, #d5ec6e ${Math.round(explode * 100)}%, #3d4436 ${Math.round(
                  explode * 100
                )}%)`,
              }}
            />
            <span className="mono-label w-6 shrink-0 text-right text-[6px] text-white/55">
              {Math.round(explode * 100)}%
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
