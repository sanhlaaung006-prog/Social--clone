import type { PartSpec } from "@/factory/warthog";

interface AirframePlanProps {
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}

export function AirframePlan({ selectedId, onSelect }: AirframePlanProps) {
  const isActive = (ids: string[]) => Boolean(selectedId && ids.includes(selectedId));
  const fill = (ids: string[]) => (isActive(ids) ? "#d5ec6e" : "#7c8670");
  const stroke = (ids: string[]) => (isActive(ids) ? "#f2ffc2" : "#a0aa91");
  const opacity = (ids: string[]) => (isActive(ids) ? 1 : 0.62);
  const groupProps = (id: string, label: string) => ({
    onClick: onSelect ? () => onSelect(id) : undefined,
    className: onSelect ? "cursor-pointer transition-opacity hover:opacity-70" : "",
    role: onSelect ? "button" : undefined,
    tabIndex: onSelect ? 0 : undefined,
    "aria-label": label,
    onKeyDown: onSelect
      ? (event: React.KeyboardEvent<SVGGElement>) => {
          if (event.key === "Enter" || event.key === " ") onSelect(id);
        }
      : undefined,
  });

  return (
    <div className="relative overflow-hidden border border-[#343a2c] bg-[#20251d]">
      <div className="flex items-center justify-between border-b border-[#3a4032] px-2.5 py-1.5">
        <span className="mono-label text-[7px] text-[#b9c2a5]">Plan view / +Y up</span>
        <span className="mono-label text-[7px] text-[#929d7e]">
          {selectedId ? selectedId.replace("-", " / ").toUpperCase() : "FULL AIRFRAME"}
        </span>
      </div>
      <svg
        viewBox="0 0 320 172"
        className="block h-auto w-full"
        role="img"
        aria-label="Top-view technical diagram of the A-10C airframe"
      >
        <defs>
          <pattern id="mini-grid" width="16" height="16" patternUnits="userSpaceOnUse">
            <path d="M 16 0 L 0 0 0 16" fill="none" stroke="#58614f" strokeWidth="0.4" opacity="0.34" />
          </pattern>
          <pattern id="mini-dots" width="8" height="8" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.45" fill="#6b7461" />
          </pattern>
        </defs>
        <rect width="320" height="172" fill="url(#mini-grid)" />
        <rect x="0" y="0" width="320" height="172" fill="url(#mini-dots)" opacity="0.24" />
        <line x1="16" y1="90" x2="306" y2="90" stroke="#596351" strokeWidth="0.6" strokeDasharray="2 5" />

        {/* wing hardpoints */}
        <g
          {...groupProps("stores", "Hardpoints and stores")}
          opacity={opacity(["stores"])}
          stroke={stroke(["stores"])}
        >
          {[54, 74, 94, 118, 138, 158].map((y) => (
            <g key={y}>
              <line x1="134" y1={y} x2="148" y2={y} strokeWidth="1.5" />
              <line x1="169" y1={y} x2="183" y2={y} strokeWidth="1.5" opacity="0.75" />
            </g>
          ))}
        </g>

        {/* wings */}
        <g {...groupProps("wing-port", "Port wing")}>
          <polygon
            points="170,82 150,26 119,28 116,82"
            fill={fill(["wing-port"])}
            stroke={stroke(["wing-port"])}
            strokeWidth="1"
            opacity={opacity(["wing-port"])}
          />
          <line x1="157" y1="27" x2="160" y2="81" stroke="#30362b" strokeWidth="0.7" />
        </g>
        <g {...groupProps("wing-starboard", "Starboard wing")}>
          <polygon
            points="170,98 150,154 119,152 116,98"
            fill={fill(["wing-starboard"])}
            stroke={stroke(["wing-starboard"])}
            strokeWidth="1"
            opacity={opacity(["wing-starboard"])}
          />
          <line x1="157" y1="153" x2="160" y2="99" stroke="#30362b" strokeWidth="0.7" />
        </g>

        {/* engines */}
        <g {...groupProps("engine-port", "Port engine")}>
          <ellipse
            cx="101"
            cy="72"
            rx="21"
            ry="10"
            fill={fill(["engine-port"])}
            stroke={stroke(["engine-port"])}
            strokeWidth="1"
            opacity={opacity(["engine-port"])}
          />
          <ellipse cx="101" cy="72" rx="6" ry="3" fill="#31382b" opacity="0.7" />
        </g>
        <g {...groupProps("engine-starboard", "Starboard engine")}>
          <ellipse
            cx="101"
            cy="128"
            rx="21"
            ry="10"
            fill={fill(["engine-starboard"])}
            stroke={stroke(["engine-starboard"])}
            strokeWidth="1"
            opacity={opacity(["engine-starboard"])}
          />
          <ellipse cx="101" cy="128" rx="6" ry="3" fill="#31382b" opacity="0.7" />
        </g>

        {/* tailplane and fins */}
        <g {...groupProps("empennage", "Tail assembly")}>
          <polygon
            points="69,91 49,69 32,70 44,91"
            fill={fill(["empennage"])}
            stroke={stroke(["empennage"])}
            strokeWidth="0.9"
            opacity={opacity(["empennage"])}
          />
          <polygon
            points="69,99 49,121 32,120 44,99"
            fill={fill(["empennage"])}
            stroke={stroke(["empennage"])}
            strokeWidth="0.9"
            opacity={opacity(["empennage"])}
          />
          <rect x="50" y="83" width="17" height="4" fill={fill(["empennage"])} opacity={opacity(["empennage"])} />
          <rect x="50" y="105" width="17" height="4" fill={fill(["empennage"])} opacity={opacity(["empennage"])} />
        </g>

        {/* fuselage */}
        <g {...groupProps("fuselage", "Fuselage")}>
          <path
            d="M37 86 Q60 83 88 83 L242 83 Q280 83 298 91 Q280 99 242 99 L88 99 Q60 99 37 94 Z"
            fill={fill(["fuselage"])}
            stroke={stroke(["fuselage"])}
            strokeWidth="1"
            opacity={isActive(["fuselage"]) ? 1 : 0.8}
          />
          <path d="M244 84 Q266 86 291 91 Q268 96 244 98 Z" fill="#4c5544" opacity="0.8" />
          <line x1="84" y1="92" x2="236" y2="92" stroke="#a4ae94" strokeWidth="0.45" opacity="0.38" />
        </g>

        {/* canopy */}
        <g {...groupProps("canopy", "Cockpit and canopy")}>
          <path
            d="M204 86 Q226 86 236 91 Q226 96 204 96 Q197 91 204 86 Z"
            fill={isActive(["canopy"]) ? "#d5ec6e" : "#26312f"}
            stroke={stroke(["canopy"])}
            strokeWidth="0.8"
            opacity={isActive(["canopy"]) ? 1 : 0.85}
          />
        </g>

        {/* gun */}
        <g {...groupProps("gun", "GAU-8 cannon")}>
          <line
            x1="266"
            y1="98"
            x2="312"
            y2="98"
            stroke={isActive(["gun"]) ? "#d5ec6e" : "#a5af94"}
            strokeWidth={isActive(["gun"]) ? 2.4 : 1.5}
            opacity={0.9}
          />
          <line x1="299" y1="96" x2="299" y2="100" stroke="#d5ec6e" strokeWidth="0.7" opacity={isActive(["gun"]) ? 1 : 0.3} />
        </g>

        {/* landing gear */}
        <g {...groupProps("gear", "Landing gear")} opacity={opacity(["gear"])}>
          <circle cx="226" cy="91" r="3" fill="none" stroke={stroke(["gear"])} strokeWidth="1.2" />
          <circle cx="151" cy="70" r="4" fill="none" stroke={stroke(["gear"])} strokeWidth="1.4" />
          <circle cx="151" cy="110" r="4" fill="none" stroke={stroke(["gear"])} strokeWidth="1.4" />
          <line x1="151" y1="70" x2="140" y2="74" stroke={stroke(["gear"])} strokeWidth="0.8" />
          <line x1="151" y1="110" x2="140" y2="106" stroke={stroke(["gear"])} strokeWidth="0.8" />
        </g>

        {/* annotations */}
        <g fontFamily="ui-monospace, monospace" fontSize="5" fill="#909b7e" letterSpacing="0.6">
          <path d="M108 20 L108 12 L200 12 L200 20" fill="none" stroke="#768268" strokeWidth="0.5" />
          <text x="139" y="9">17.53 M</text>
          <path d="M306 45 L314 45 L314 141 L306 141" fill="none" stroke="#768268" strokeWidth="0.5" />
          <text x="310" y="95" transform="rotate(90 310 95)">16.26 M</text>
          <text x="16" y="18">A-10C / DATUM</text>
          <text x="16" y="160">SCALE 1:240</text>
          <line x1="16" y1="153" x2="52" y2="153" stroke="#7f8b6f" strokeWidth="0.7" />
          <line x1="16" y1="150" x2="16" y2="156" stroke="#7f8b6f" strokeWidth="0.7" />
          <line x1="52" y1="150" x2="52" y2="156" stroke="#7f8b6f" strokeWidth="0.7" />
          <text x="252" y="160">NOSE +Z</text>
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 border border-[#3c4434]/50" />
    </div>
  );
}

export function SpecPlanSection({ part }: { part: PartSpec }) {
  return (
    <div className="mt-3">
      <AirframePlan selectedId={part.id} />
    </div>
  );
}
