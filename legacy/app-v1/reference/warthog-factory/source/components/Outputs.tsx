import { useState } from "react";
import type { LiveryId, LoadoutId } from "@/factory/warthog";
import { LOADOUTS } from "@/factory/warthog";
import type { SceneStats } from "@/factory/scene";
import {
  copySource,
  downloadCsv,
  downloadManifest,
  downloadSource,
  manifestJson,
} from "@/factory/extract";
import {
  ArrowUpRight,
  Camera,
  Check,
  Code,
  Copy,
  Download,
  File,
  Ruler,
} from "@/components/Icons";

interface OutputsProps {
  livery: LiveryId;
  loadout: LoadoutId;
  stats: SceneStats;
  onScreenshot: () => void;
  onNotify: (message: string) => void;
}

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

function CardHeader({
  index,
  title,
  description,
  icon,
  light = true,
}: {
  index: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  light?: boolean;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 px-4 pb-3 pt-4 ${light ? "" : "border-b border-white/10"}`}>
      <div>
        <span className={`mono-label text-[7px] ${light ? "text-faint" : "text-white/35"}`}>
          {index} / OUTPUT
        </span>
        <h3 className={`mt-1.5 text-[15px] font-semibold tracking-[-0.02em] ${light ? "text-ink" : "text-white"}`}>
          {title}
        </h3>
        <p className={`mt-1 text-[10px] leading-[1.5] ${light ? "text-muted" : "text-white/40"}`}>
          {description}
        </p>
      </div>
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center border ${
          light ? "border-line bg-paper text-olive" : "border-white/15 bg-white/5 text-lime"
        }`}
      >
        {icon}
      </span>
    </div>
  );
}

export function Outputs({ livery, loadout, stats, onScreenshot, onNotify }: OutputsProps) {
  const [copiedSource, setCopiedSource] = useState(false);
  const [copiedManifest, setCopiedManifest] = useState(false);

  const loadoutLabel = LOADOUTS.find((item) => item.id === loadout)?.label ?? "Standard";

  const handleCopySource = async () => {
    const ok = await copySource();
    if (ok) {
      setCopiedSource(true);
      onNotify("Factory source copied to clipboard");
      window.setTimeout(() => setCopiedSource(false), 2200);
    } else {
      downloadSource();
      onNotify("Clipboard blocked — source downloaded instead");
    }
  };

  const handleCopyManifest = async () => {
    try {
      await navigator.clipboard.writeText(manifestJson({ livery, loadout }));
      setCopiedManifest(true);
      onNotify("Airframe manifest copied");
      window.setTimeout(() => setCopiedManifest(false), 2200);
    } catch {
      downloadManifest({ livery, loadout });
      onNotify("Clipboard blocked — manifest downloaded");
    }
  };

  const handleManifest = () => {
    downloadManifest({ livery, loadout });
    onNotify("Manifest downloaded");
  };

  const handleSource = () => {
    downloadSource();
    onNotify("warthog.factory.ts downloaded");
  };

  const handleCsv = () => {
    downloadCsv();
    onNotify("Parts inventory downloaded");
  };

  const manifestLines: Array<[string, string, string]> = [
    ["schema", '"warthog-factory/airframe@1.0"', "#c9d5a8"],
    ["airframe", '"A-10C Thunderbolt II"', "#e7e3ce"],
    ["parts", "10", "#d5ec6e"],
    ["units", '"metres"', "#e7e3ce"],
    ['config.loadout', `"${loadoutLabel.toLowerCase()}"`, "#e7e3ce"],
    ["assets.external", "0", "#d5ec6e"],
  ];

  return (
    <section id="extract" className="mx-auto w-full max-w-[1720px] px-4 pb-14 pt-12 sm:px-6 lg:px-8 lg:pb-20 lg:pt-16">
      <div className="flex flex-col gap-5 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="mono-label text-[9px] text-muted">Extraction desk</span>
            <span className="h-px w-8 bg-line-dark" />
            <span className="mono-label text-[8px] text-faint">03 outputs</span>
          </div>
          <h2 className="display mt-3 text-[34px] font-semibold text-ink sm:text-[42px]">
            Built to be pulled apart.
          </h2>
        </div>
        <p className="max-w-[350px] text-[12px] leading-[1.65] text-muted">
          Every component, dimension and material is declared in code. Take the manifest
          for recreation, the full table for reference, the source for your own scene.
        </p>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-12">
        {/* Manifest */}
        <div className="flex flex-col border border-line bg-panel lg:col-span-5">
          <CardHeader
            index="01"
            title="Airframe manifest"
            description="Machine-readable component index and dimensions."
            icon={<File className="h-3.5 w-3.5" />}
          />
          <div className="mx-4 min-h-0 flex-1 border border-line bg-ink p-3 font-mono text-[9px] leading-[1.85]">
            <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-2">
              <span className="text-[7px] tracking-[0.14em] text-white/35">MANIFEST.JSON</span>
              <span className="text-[7px] tracking-[0.14em] text-lime/70">VALID</span>
            </div>
            <div className="text-white/35">{"{"}</div>
            {manifestLines.map(([key, value, color], index) => (
              <div key={key} className="flex min-w-0 gap-2 pl-2">
                <span className="w-3 shrink-0 text-right text-white/20">{index + 1}</span>
                <span className="truncate">
                  <span style={{ color: "#a9b393" }}>&quot;{key}&quot;</span>
                  <span className="text-white/35">: </span>
                  <span style={{ color }}>{value}</span>
                  {index < manifestLines.length - 1 ? <span className="text-white/25">,</span> : null}
                </span>
              </div>
            ))}
            <div className="text-white/35">{"}"}</div>
          </div>
          <div className="flex gap-1.5 p-4 pt-3">
            <button
              type="button"
              onClick={handleManifest}
              className="flex flex-1 items-center justify-center gap-1.5 border border-ink bg-ink px-2 py-2.5 text-[10px] font-medium text-paper transition-colors hover:bg-olive"
            >
              <Download className="h-3 w-3" />
              Download .json
            </button>
            <button
              type="button"
              onClick={handleCopyManifest}
              title="Copy manifest"
              aria-label="Copy manifest"
              className="flex w-10 items-center justify-center border border-line-dark text-ink transition-colors hover:border-ink hover:bg-paper"
            >
              {copiedManifest ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Source */}
        <div className="flex flex-col border border-[#333a2c] bg-[#22271e] text-white lg:col-span-4">
          <CardHeader
            index="02"
            title="Factory source"
            description="The complete procedural builder, ready for your own project."
            icon={<Code className="h-3.5 w-3.5" />}
            light={false}
          />
          <div className="mx-4 min-h-0 flex-1 overflow-hidden border border-white/10 bg-[#181c15]">
            <div className="flex items-center justify-between border-b border-white/10 px-2.5 py-1.5">
              <span className="font-mono text-[8px] text-white/45">warthog.factory.ts</span>
              <span className="mono-label bg-lime px-1 py-0.5 text-[6px] text-ink">TS</span>
            </div>
            <pre className="thin-scroll overflow-x-auto p-3 font-mono text-[9px] leading-[1.9]">
              <code>
                <span style={{ color: "#89987a" }}>{"// Three.js only. No assets."}</span>
                {"\n"}
                <span style={{ color: "#d5ec6e" }}>import</span>
                <span style={{ color: "#d8d8c8" }}> {"{ createWarthogAssembly }"}</span>
                {"\n"}
                <span style={{ color: "#d5ec6e" }}>from</span>
                <span style={{ color: "#b8c795" }}> {"'./warthog.factory'"}</span>
                <span style={{ color: "#d8d8c8" }}>;</span>
                {"\n\n"}
                <span style={{ color: "#d5ec6e" }}>const</span>
                <span style={{ color: "#e7e3ce" }}> hog </span>
                <span style={{ color: "#d8d8c8" }}>=</span>
                <span style={{ color: "#e7e3ce" }}> createWarthogAssembly</span>
                <span style={{ color: "#d8d8c8" }}>(</span>
                {"\n"}
                <span style={{ color: "#b8c795" }}>  &quot;sage&quot;</span>
                <span style={{ color: "#d8d8c8" }}>, </span>
                <span style={{ color: "#b8c795" }}>&quot;standard&quot;</span>
                {"\n"}
                <span style={{ color: "#d8d8c8" }}>);</span>
                {"\n\n"}
                <span style={{ color: "#e7e3ce" }}>scene</span>
                <span style={{ color: "#d8d8c8" }}>.add(hog.</span>
                <span style={{ color: "#e7e3ce" }}>root</span>
                <span style={{ color: "#d8d8c8" }}>);</span>
                {"\n"}
                <span style={{ color: "#e7e3ce" }}>hog</span>
                <span style={{ color: "#d8d8c8" }}>.setExplode(</span>
                <span style={{ color: "#d5ec6e" }}>0.6</span>
                <span style={{ color: "#d8d8c8" }}>);</span>
                <span className="inline-block h-[9px] w-[1px] animate-pulse bg-lime align-middle" />
              </code>
            </pre>
          </div>
          <div className="flex gap-1.5 p-4 pt-3">
            <button
              type="button"
              onClick={handleCopySource}
              className="flex flex-1 items-center justify-center gap-1.5 border border-lime bg-lime px-2 py-2.5 text-[10px] font-medium text-ink transition-colors hover:bg-[#e2f594]"
            >
              {copiedSource ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copiedSource ? "Copied" : "Copy source"}
            </button>
            <button
              type="button"
              onClick={handleSource}
              title="Download TypeScript factory"
              aria-label="Download TypeScript factory"
              className="flex w-10 items-center justify-center border border-white/20 text-white/70 transition-colors hover:border-white/45 hover:bg-white/5 hover:text-white"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Reference kit */}
        <div className="flex flex-col border border-line bg-panel lg:col-span-3">
          <CardHeader
            index="03"
            title="Reference kit"
            description="A visual plate and the full parts inventory."
            icon={<Ruler className="h-3.5 w-3.5" />}
          />
          <div className="mx-4 min-h-0 flex-1">
            <button
              type="button"
              onClick={onScreenshot}
              className="group relative flex h-[108px] w-full flex-col items-center justify-center overflow-hidden border border-line bg-[#252b22] text-center transition-colors hover:border-[#8b9a66]"
            >
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(213,236,110,0.16),transparent_68%)]" />
              <div className="absolute inset-0 bg-[linear-gradient(rgba(213,236,110,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(213,236,110,0.06)_1px,transparent_1px)] [background-size:16px_16px]" />
              <Camera className="relative h-4 w-4 text-lime/80" />
              <span className="mono-label relative mt-2 text-[7px] text-white/70">
                Download viewport plate
              </span>
              <span className="mono-label relative mt-1 text-[6px] text-white/30">
                PNG / current camera
              </span>
              <ArrowUpRight className="absolute right-2 top-2 h-3 w-3 text-white/30 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </button>

            <button
              type="button"
              onClick={handleCsv}
              className="mt-1.5 flex w-full items-center justify-between border border-line px-2.5 py-2 text-left transition-colors hover:border-line-dark hover:bg-paper"
            >
              <span className="flex items-center gap-2">
                <File className="h-3 w-3 text-muted" />
                <span className="text-[10px] text-ink">Parts inventory</span>
              </span>
              <span className="mono-label text-[7px] text-faint">.CSV</span>
            </button>

            <div className="mt-2.5 grid grid-cols-3 border border-line bg-paper/60">
              {[
                { label: "Parts", value: stats.parts || 10 },
                { label: "Tris", value: stats.triangles ? formatNumber(stats.triangles) : "—" },
                { label: "Assets", value: 0 },
              ].map((item, index) => (
                <div key={item.label} className={`px-1.5 py-2 ${index < 2 ? "border-r border-line" : ""}`}>
                  <p className="mono-label text-[6px] text-faint">{item.label}</p>
                  <p className="mt-0.5 font-mono text-[11px] leading-none text-ink">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="p-4 pt-3">
            <p className="mono-label text-[6px] leading-relaxed normal-case tracking-[0.04em] text-faint">
              Stylised reference geometry. Not a manufacturing drawing or official
              Department of Defense release.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 border border-line bg-panel-deep/55 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="mono-label text-[7px] text-muted">Kit contents</span>
          {["01 manifest", "10 component definitions", "01 TS source module", "01 plate render", "01 parts table"].map(
            (item) => (
              <span key={item} className="mono-label flex items-center gap-1.5 text-[7px] text-faint">
                <span className="h-1 w-1 rounded-full bg-[#93a46b]" />
                {item}
              </span>
            )
          )}
        </div>
        <span className="mono-label shrink-0 text-[7px] text-faint">MIT-compatible · reference build 1.0</span>
      </div>
    </section>
  );
}
