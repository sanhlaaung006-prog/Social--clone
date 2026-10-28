/* Shared HUD contract between the engine and the React overlay. */

export type MatchStatus = "menu" | "playing" | "dead" | "won";
export type VehicleSeat = "driver" | "passenger";

export interface KillFeedEntry {
  id: number;
  text: string;
}

export interface MinimapBlip {
  x: number;
  z: number;
  kind: "player" | "bot" | "pickup" | "vehicle";
}

export interface HudSnapshot {
  status: MatchStatus;
  hp: number;
  maxHp: number;
  mag: number;
  magSize: number;
  reserve: number;
  reloading: boolean;
  kills: number;
  alive: number;
  placement: number;
  zonePhase: number;
  zonePhases: number;
  zoneTimer: number;
  zoneState: "waiting" | "shrinking" | "done";
  outsideZone: boolean;
  hitMarkerAt: number;
  damageAt: number;
  killFeed: KillFeedEntry[];
  wasmReady: boolean;
  pointerLocked: boolean;
  /** Full world coordinates for the minimap canvas. */
  player: { x: number; z: number; yaw: number };
  zone: { x: number; z: number; r: number };
  blips: MinimapBlip[];
  inVehicle: boolean;
  vehicleKind: "tank" | "technical" | "jet" | "warthog" | null;
  vehicleSeat: VehicleSeat | null;
  canEnterVehicle: boolean;
  canSwapSeat: boolean;
  nearbyVehicleLabel: string | null;
  gunnerActive: boolean;
}
