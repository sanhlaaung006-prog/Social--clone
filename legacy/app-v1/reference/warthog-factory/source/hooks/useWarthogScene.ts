import { useCallback, useEffect, useRef, useState } from "react";
import {
  createWarthogScene,
  type SceneStats,
  type WarthogScene,
} from "@/factory/scene";

export interface UseWarthogScene {
  containerRef: React.RefObject<HTMLDivElement | null>;
  sceneRef: React.RefObject<WarthogScene | null>;
  stats: SceneStats;
  ready: boolean;
  error: string | null;
  selectedId: string;
  hoveredId: string | null;
  selectPart: (id: string) => void;
}

const EMPTY_STATS: SceneStats = { parts: 0, meshes: 0, triangles: 0, materials: 0 };

export function useWarthogScene(): UseWarthogScene {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<WarthogScene | null>(null);
  const [stats, setStats] = useState<SceneStats>(EMPTY_STATS);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("fuselage");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let scene: WarthogScene | null = null;

    try {
      scene = createWarthogScene(container, {
        onSelect: (id) => setSelectedId(id),
        onHover: (id) => setHoveredId(id),
      });
      sceneRef.current = scene;
      setStats(scene.stats);
      setReady(true);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The WebGL renderer could not be initialised on this device."
      );
      setReady(false);
    }

    return () => {
      scene?.dispose();
      sceneRef.current = null;
      setReady(false);
    };
  }, []);

  const selectPart = useCallback((id: string) => {
    setSelectedId(id);
    sceneRef.current?.setSelected(id);
  }, []);

  return {
    containerRef,
    sceneRef,
    stats,
    ready,
    error,
    selectedId,
    hoveredId,
    selectPart,
  };
}
