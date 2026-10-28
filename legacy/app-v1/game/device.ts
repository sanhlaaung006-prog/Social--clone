/*
 * Device quality tiers. "low" is the aggressive mobile profile: shorter
 * cull radii, denser fog, fewer instances, cheaper shadows. "high" is the
 * desktop / strong-tablet profile. The tier can be forced with
 * ?quality=low or ?quality=high on the URL for testing and user override.
 */

export type QualityTier = "high" | "low";

export interface DeviceSignals {
  mobileUA: boolean;
  coarsePointer: boolean;
  shortScreen: boolean;
  weakCpu: boolean;
  lowMemory: boolean;
}

/** Pure decision function, split out so headless tests can exercise it. */
export function tierFromSignals(s: DeviceSignals): QualityTier {
  if (s.lowMemory) return "low";
  if (s.mobileUA) return "low";
  if (s.coarsePointer && (s.shortScreen || s.weakCpu)) return "low";
  return "high";
}

export function detectTier(): QualityTier {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "high";
  }
  const forced = new URLSearchParams(window.location.search).get("quality");
  if (forced === "low" || forced === "high") return forced;

  const ua = navigator.userAgent || "";
  const nav = navigator as Navigator & { deviceMemory?: number };
  return tierFromSignals({
    mobileUA: /Android|iPhone|iPad|iPod|Mobile/i.test(ua),
    coarsePointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
    shortScreen: Math.min(window.screen.width, window.screen.height) < 760,
    weakCpu: (navigator.hardwareConcurrency || 8) <= 4,
    lowMemory: typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4,
  });
}
