"use client";

import { useEffect, useRef } from "react";
import type { HudSnapshot } from "@/game/hud";
import { CONFIG } from "@/game/config";

const SIZE = 128;

/** North-up tactical minimap rendered on a 2D canvas. */
export default function Minimap({ hud }: { hud: HudSnapshot }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scale = SIZE / CONFIG.world.size;
    const toX = (x: number) => SIZE / 2 + x * scale;
    const toY = (z: number) => SIZE / 2 + z * scale;

    ctx.clearRect(0, 0, SIZE, SIZE);

    // Backdrop.
    ctx.fillStyle = "rgba(16,26,17,0.85)";
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Zone circle.
    ctx.beginPath();
    ctx.arc(toX(hud.zone.x), toY(hud.zone.z), hud.zone.r * scale, 0, Math.PI * 2);
    ctx.strokeStyle = hud.zoneState === "shrinking" ? "#ff5a52" : "#69d2ff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Blips.
    for (const b of hud.blips) {
      ctx.beginPath();
      ctx.arc(toX(b.x), toY(b.z), b.kind === "bot" ? 2.6 : 2, 0, Math.PI * 2);
      ctx.fillStyle = b.kind === "bot" ? "#ff6f68" : "#ffd166";
      ctx.fill();
    }

    // Player arrow.
    const px = toX(hud.player.x);
    const py = toY(hud.player.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-hud.player.yaw);
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();
  }, [hud]);

  return <canvas ref={ref} width={SIZE} height={SIZE} className="minimap" />;
}
