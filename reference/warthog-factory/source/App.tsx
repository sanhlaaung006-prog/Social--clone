import { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "@/components/Header";
import { PartRail } from "@/components/PartRail";
import { Viewport } from "@/components/Viewport";
import { Inspector } from "@/components/Inspector";
import { Outputs } from "@/components/Outputs";
import { ArrowUpRight, BrandMark, Check, Copy, Download, Info } from "@/components/Icons";
import { useWarthogScene } from "@/hooks/useWarthogScene";
import type { ViewId } from "@/factory/scene";
import {
  PART_SPECS,
  WARTHOG_SPECS,
  type LiveryId,
  type LoadoutId,
} from "@/factory/warthog";

type Target = "top" | "assembly" | "reference" | "extract";

const FACT_STRIP = [
  { label: "Airframe", value: "Semi-monocoque" },
  { label: "Powerplant", value: "2 × TF34 turbofan" },
  { label: "Primary gun", value: "GAU-8/A 30 mm" },
  { label: "Mission", value: "Close air support" },
  { label: "Generation", value: "100% procedural" },
];

export default function App() {
  const {
    containerRef,
    sceneRef,
    stats,
    ready,
    error,
    selectedId,
    hoveredId,
    selectPart,
  } = useWarthogScene();

  const [view, setView] = useState<ViewId>("iso");
  const [autoRotate, setAutoRotate] = useState(false);
  const [blueprint, setBlueprint] = useState(false);
  const [explode, setExplode] = useState(0);
  const [loadout, setLoadout] = useState<LoadoutId>("standard");
  const [livery, setLivery] = useState<LiveryId>("sage");
  const [units, setUnits] = useState<"m" | "ft">("m");
  const [soloId, setSoloId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const selected = PART_SPECS.find((part) => part.id === selectedId) ?? PART_SPECS[0];
  const soloPart = PART_SPECS.find((part) => part.id === soloId);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const navigate = useCallback((target: Target) => {
    const id = target === "top" ? "top" : target;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleSelect = useCallback(
    (id: string) => {
      if (soloId && soloId !== id) {
        setSoloId(null);
        sceneRef.current?.setIsolate(null);
      }
      selectPart(id);
    },
    [sceneRef, selectPart, soloId]
  );

  const handleIsolate = (id: string) => {
    if (soloId === id) {
      setSoloId(null);
      sceneRef.current?.setIsolate(null);
      return;
    }
    setSoloId(id);
    sceneRef.current?.setIsolate(id);
    const part = PART_SPECS.find((item) => item.id === id);
    if (part) notify(`Solo view · ${part.name}`);
  };

  const handleClearSolo = () => {
    setSoloId(null);
    sceneRef.current?.setIsolate(null);
  };

  const handleView = (next: ViewId) => {
    setView(next);
    sceneRef.current?.setView(next);
  };

  const handleLivery = (next: LiveryId) => {
    setLivery(next);
    sceneRef.current?.setLivery(next);
  };

  const handleLoadout = (next: LoadoutId) => {
    setLoadout(next);
    sceneRef.current?.setLoadout(next);
  };

  const handleAutoRotate = () => {
    const next = !autoRotate;
    setAutoRotate(next);
    sceneRef.current?.setAutoRotate(next);
  };

  const handleBlueprint = () => {
    const next = !blueprint;
    setBlueprint(next);
    sceneRef.current?.setBlueprint(next);
  };

  const handleExplode = (value: number) => {
    setExplode(value);
    sceneRef.current?.setExplode(value);
  };

  const handleReset = () => {
    setView("iso");
    sceneRef.current?.setView("iso");
  };

  const handleScreenshot = () => {
    sceneRef.current?.screenshot();
    notify("Viewport plate downloading as PNG");
  };

  return (
    <div id="top" className="min-h-screen text-ink">
      <Header onNavigate={navigate} onExport={() => navigate("extract")} />

      <section className="mx-auto w-full max-w-[1720px] px-4 pb-6 pt-6 sm:px-6 lg:px-8 lg:pb-7 lg:pt-8">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <span className="mono-label text-[8px] text-muted">Factory</span>
            <span className="text-[9px] text-line-dark">/</span>
            <span className="mono-label text-[8px] text-muted">Reference airframe</span>
            <span className="text-[9px] text-line-dark">/</span>
            <span className="mono-label text-[8px] text-ink">A-10C</span>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <span className="mono-label text-[7px] text-faint">Build 1.0 · rev 04</span>
            <span className="h-3 w-px bg-line" />
            <span className="mono-label text-[7px] text-faint">Ref. USAF / public domain</span>
          </div>
        </div>

        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-10">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="mono-label flex items-center gap-1.5 border border-[#b9c888] bg-[#eaf1cd] px-2 py-1 text-[7px] text-[#4e5f2e]">
                <span className="live-dot h-1 w-1 rounded-full bg-[#6f8a3e]" />
                Reference model
              </span>
              <span className="mono-label text-[7px] text-faint">1972 — present</span>
            </div>

            <h1 className="display mt-3 text-[44px] font-semibold text-ink sm:text-[58px] lg:text-[66px]">
              A-10C{" "}
              <span className="font-serif text-[0.67em] font-normal italic tracking-[-0.045em] text-[#777c6c]">
                Thunderbolt II
              </span>
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <p className="max-w-[520px] text-[12px] leading-[1.65] text-muted">
                A clean, part-by-part procedural study of the close air support legend.
                Inspect the airframe, rebuild the loadout, and extract the whole factory.
              </p>
              <span className="border border-line px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-ink">
                Warthog
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end lg:flex-col lg:items-stretch">
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => navigate("extract")}
                className="group flex flex-1 items-center justify-between gap-6 border border-ink bg-ink px-3.5 py-2.5 text-[11px] font-medium text-paper transition-colors hover:bg-olive lg:flex-none"
              >
                <span className="flex items-center gap-2">
                  <Download className="h-3.5 w-3.5 text-lime" />
                  Extract the kit
                </span>
                <ArrowUpRight className="h-3.5 w-3.5 text-lime transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </button>
              <button
                type="button"
                onClick={() => navigate("reference")}
                className="flex items-center gap-1.5 border border-line-dark bg-panel px-3 py-2.5 text-[11px] text-ink transition-colors hover:border-ink hover:bg-paper"
              >
                <Info className="h-3.5 w-3.5" />
                Spec sheet
              </button>
            </div>

            <div className="grid grid-cols-3 divide-x divide-line border border-line bg-panel">
              {[
                { label: "Wingspan", value: WARTHOG_SPECS.wingspanM.toFixed(2), unit: "m" },
                { label: "Length", value: WARTHOG_SPECS.lengthM.toFixed(2), unit: "m" },
                { label: "Components", value: String(PART_SPECS.length).padStart(2, "0"), unit: "" },
              ].map((metric) => (
                <div key={metric.label} className="px-3 py-2.5">
                  <p className="mono-label text-[6.5px] text-faint">{metric.label}</p>
                  <p className="mt-1 font-mono text-[17px] leading-none tracking-[-0.04em] text-ink">
                    {metric.value}
                    <span className="ml-0.5 text-[8px] tracking-normal text-faint">{metric.unit}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-y border-line py-2.5 lg:mt-6">
          <div className="flex items-center gap-2">
            <span className="mono-label text-[8px] text-muted">Assembly bay</span>
            <span className="h-px w-7 bg-line-dark" />
            <span className="mono-label text-[8px] text-faint">Model / A-10C-REF-01</span>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <span className="mono-label flex items-center gap-1.5 text-[7px] text-faint">
              <span className="h-1 w-1 rounded-full bg-[#7f9a4a]" />
              Geometry live
            </span>
            <span className="mono-label text-[7px] text-faint">Drag orbit · scroll zoom</span>
            <span className="mono-label text-[7px] text-faint">Click part to inspect</span>
          </div>
          <span className="mono-label text-[7px] text-muted">
            {stats.meshes ? `${stats.meshes} meshes` : "Initialising"}
          </span>
        </div>
      </section>

      <main>
        <section id="assembly" className="mx-auto w-full max-w-[1720px] scroll-mt-20 px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[234px_minmax(0,1fr)] lg:items-start xl:grid-cols-[234px_minmax(0,1fr)_320px]">
            <div className="order-2 min-w-0 lg:order-1 lg:col-start-1 lg:row-start-1 xl:order-none">
              <PartRail
                parts={PART_SPECS}
                selectedId={selected.id}
                hoveredId={hoveredId}
                stats={stats}
                onSelect={handleSelect}
              />
            </div>
            <div className="order-1 min-w-0 lg:order-2 lg:col-start-2 lg:row-start-1 xl:order-none">
              <Viewport
                containerRef={containerRef}
                ready={ready}
                error={error}
                selected={selected}
                view={view}
                autoRotate={autoRotate}
                blueprint={blueprint}
                explode={explode}
                loadout={loadout}
                soloId={soloId}
                soloName={soloPart?.name}
                onView={handleView}
                onAutoRotate={handleAutoRotate}
                onBlueprint={handleBlueprint}
                onScreenshot={handleScreenshot}
                onReset={handleReset}
                onExplode={handleExplode}
                onLoadout={handleLoadout}
                onClearSolo={handleClearSolo}
              />
            </div>
            <div className="order-3 min-w-0 lg:col-span-2 lg:row-start-2 xl:order-none xl:col-span-1 xl:col-start-3 xl:row-start-1">
              <div className="mx-auto w-full lg:max-w-[640px] xl:max-w-none">
                <Inspector
                  selected={selected}
                  soloId={soloId}
                  units={units}
                  livery={livery}
                  loadout={loadout}
                  onSelectPart={handleSelect}
                  onUnitsChange={setUnits}
                  onLiveryChange={handleLivery}
                  onIsolate={handleIsolate}
                  onClearSolo={handleClearSolo}
                  onFocus={(id) => {
                    sceneRef.current?.focusPart(id);
                    notify(`Framing ${PART_SPECS.find((item) => item.id === id)?.name ?? "part"}`);
                  }}
                />
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 border border-line bg-panel sm:grid-cols-3 lg:grid-cols-5">
            {FACT_STRIP.map((fact, index) => (
              <div
                key={fact.label}
                className={`px-3 py-2.5 ${index < FACT_STRIP.length - 1 ? "border-r border-line" : ""} ${
                  index === 4 ? "col-span-2 border-t border-line sm:col-span-1 sm:border-t-0" : ""
                }`}
              >
                <p className="mono-label text-[6.5px] text-faint">{fact.label}</p>
                <p className="mt-1 text-[10px] font-medium text-ink">{fact.value}</p>
              </div>
            ))}
          </div>
        </section>

        <Outputs
          livery={livery}
          loadout={loadout}
          stats={stats}
          onScreenshot={handleScreenshot}
          onNotify={notify}
        />

        <section className="mx-auto w-full max-w-[1720px] px-4 pb-12 sm:px-6 lg:px-8">
          <div className="grid border border-line bg-panel lg:grid-cols-[1.25fr_1fr_1fr]">
            <div className="flex flex-col justify-between gap-5 border-b border-line px-4 py-4 lg:border-b-0 lg:border-r">
              <div>
                <div className="flex items-center gap-2">
                  <span className="mono-label text-[7px] text-faint">Reference note</span>
                  <span className="h-px flex-1 bg-line" />
                </div>
                <p className="mt-2.5 max-w-[430px] text-[12px] leading-[1.65] text-muted">
                  The Warthog was designed around its gun. The GAU-8/A demanded a large
                  forward fuselage, an offset nose gear and a titanium pilot tub — choices
                  that still define the silhouette.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="border border-line bg-paper px-2 py-1 font-mono text-[8px] text-muted">
                  s/n 82-0654
                </span>
                <span className="mono-label text-[7px] text-faint">Stylised reference geometry</span>
              </div>
            </div>
            {[
              {
                label: "A-10C / provenance",
                value: `${WARTHOG_SPECS.unitsBuilt} airframes`,
                detail: `First flight ${WARTHOG_SPECS.firstFlight}. Broad wing, twin turbofans and eleven hardpoints.`,
              },
              {
                label: "In the code",
                value: "Superellipse lofts",
                detail: "Extruded wing and tail planforms, canvas stencils, high-mounted nacelles and a seven-barrel cannon.",
              },
            ].map((note) => (
              <div key={note.label} className="border-b border-line px-4 py-4 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
                <p className="mono-label text-[7px] text-faint">{note.label}</p>
                <p className="mt-2 text-[14px] font-semibold tracking-[-0.02em] text-ink">{note.value}</p>
                <p className="mt-1.5 text-[10px] leading-[1.6] text-muted">{note.detail}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-panel-deep/65">
        <div className="mx-auto w-full max-w-[1720px] px-4 pb-7 pt-8 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-7 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-3">
              <BrandMark className="h-9 w-9" />
              <div>
                <p className="text-[13px] font-bold tracking-[0.16em] text-ink">WARTHOG</p>
                <p className="mono-label mt-1 text-[8px] text-muted">Airframe factory / reference lab</p>
                <p className="mt-3 max-w-[330px] text-[10px] leading-[1.65] text-muted">
                  A reusable, fully procedural Three.js airframe. Built for recreation,
                  study and making something new.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
              <div>
                <p className="mono-label text-[7px] text-faint">Workspace</p>
                <button type="button" onClick={() => navigate("assembly")} className="mt-2 block text-[11px] text-muted hover:text-ink">Assembly bay</button>
                <button type="button" onClick={() => navigate("reference")} className="mt-1.5 block text-[11px] text-muted hover:text-ink">Part inspector</button>
                <button type="button" onClick={() => navigate("extract")} className="mt-1.5 block text-[11px] text-muted hover:text-ink">Extraction desk</button>
              </div>
              <div>
                <p className="mono-label text-[7px] text-faint">Outputs</p>
                <button type="button" onClick={() => navigate("extract")} className="mt-2 block text-[11px] text-muted hover:text-ink">Manifest</button>
                <button type="button" onClick={() => navigate("extract")} className="mt-1.5 block text-[11px] text-muted hover:text-ink">TypeScript source</button>
                <button type="button" onClick={() => navigate("extract")} className="mt-1.5 block text-[11px] text-muted hover:text-ink">Reference plate</button>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <p className="mono-label text-[7px] text-faint">Build</p>
                <p className="mt-2 text-[11px] leading-[1.65] text-muted">
                  Three.js + WebGL<br />
                  No external assets<br />
                  No model downloads
                </p>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="mono-label text-[7px] leading-relaxed text-faint">
              Independent reference reconstruction. Not affiliated with the USAF or Fairchild Republic.
            </p>
            <div className="flex items-center gap-3">
              <span className="mono-label flex items-center gap-1.5 text-[7px] text-muted">
                <Check className="h-2.5 w-2.5 text-[#718a42]" /> Render-ready
              </span>
              <button
                type="button"
                onClick={() => navigate("top")}
                className="mono-label flex items-center gap-1 text-[7px] text-muted transition-colors hover:text-ink"
              >
                Back to top <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </footer>

      {toast ? (
        <div className="toast-in fixed bottom-4 left-1/2 z-[100] flex w-max max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2.5 border border-[#3e4635] bg-[#1c2118] px-3 py-2.5 text-paper shadow-[0_18px_50px_rgba(0,0,0,0.25)]">
          <span className="flex h-5 w-5 items-center justify-center border border-lime/40 bg-lime/10">
            <Copy className="h-3 w-3 text-lime" />
          </span>
          <span className="text-[11px]">{toast}</span>
        </div>
      ) : null}
    </div>
  );
}
