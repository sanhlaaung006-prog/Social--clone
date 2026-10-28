import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

export function ArrowUpRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

export function Download(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 17.5v2.2h16v-2.2" />
    </svg>
  );
}

export function Copy(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="9" width="11" height="11" rx="1" />
      <path d="M15 5.5V4H4v11h1.5" />
    </svg>
  );
}

export function Check(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m4 12.5 5 5L20 6.5" />
    </svg>
  );
}

export function Orbit(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.6 8.7c1.2 2.4.5 5.6-1.9 7.9-2.8 2.7-6.8 3.2-9 1s-1.7-6.2 1.1-8.9 6.8-3.2 9-1" />
      <path d="M8.5 5.3 5 4l1.3 3.5M15.5 18.7 19 20l-1.3-3.5" />
    </svg>
  );
}

export function Camera(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 8h3l1.4-2h7.2L17 8h3v11H4z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}

export function Blueprint(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 18 9 5l6 13M5.5 13h7" />
      <path d="M16 5h5v13h-5M18.5 9v5" />
    </svg>
  );
}

export function Target(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

export function Reset(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 5v5h5" />
      <path d="M5.2 15.5A7.5 7.5 0 1 0 6 6.8L4 10" />
    </svg>
  );
}

export function Expand(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 4h6v6M20 4l-6 6M10 20H4v-6M4 20l6-6" />
    </svg>
  );
}

export function Explode(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m12 3 7 4v10l-7 4-7-4V7z" />
      <path d="m12 3 7 4-7 4-7-4M12 11v10" />
    </svg>
  );
}

export function Isolate(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 9V4h5M21 9V4h-5M3 15v5h5M21 15v5h-5" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

export function Frame(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
      <path d="M8 12h8" />
    </svg>
  );
}

export function ChevronRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function Plus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function Close(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function Ruler(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m4 15 11-11 5 5L9 20z" />
      <path d="m8 11-2 2M11 8 9 6M14 15l-2 2M17 12l-2 2" />
    </svg>
  );
}

export function Info(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </svg>
  );
}

export function Cube(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="m12 12 8-4.5M12 12 4 7.5M12 12v9" />
    </svg>
  );
}

export function Code(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m8 6-5 6 5 6M16 6l5 6-5 6M14 4l-4 16" />
    </svg>
  );
}

export function File(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 3h9l5 5v13H5z" />
      <path d="M14 3v5h5M8 13h8M8 17h5" />
    </svg>
  );
}

export function BrandMark(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden {...props}>
      <rect width="32" height="32" rx="2" fill="#1B1E18" />
      <path
        d="M16 5.5c.8 0 1.25.8 1.25 2v5.2l8.7 4.8v2.2l-8.7-2.5v6.1l2.3 1.6v1.6L16 26l-3.55.9v-1.6l2.3-1.6v-6.1l-8.7 2.5v-2.2l8.7-4.8V7.5c0-1.2.45-2 1.25-2Z"
        fill="#D5EC6E"
      />
      <circle cx="16" cy="3.8" r="1.1" fill="#D5EC6E" />
    </svg>
  );
}
