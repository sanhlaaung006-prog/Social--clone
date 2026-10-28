/**
 * INSPECTION RIG — extracted from `factory/scene.ts`
 * ------------------------------------------------------------------
 * The camera + picking half of the reference project, decoupled from the
 * A-10 model so it can drive any inspectable object tree (tank, technical,
 * jet, or a loot crate). Three.js only; no React, no DOM globals beyond
 * the container element you hand it.
 *
 * What it gives you:
 *   - eased fly-to moves that are interrupted cleanly by user input
 *   - `focusOn(object)` framing maths that keeps any part in shot
 *   - tap-vs-drag disambiguation for pointer picking (phone friendly)
 *   - rAF-throttled hover picking
 *   - portrait-aware FOV/framing scale so narrow phones still fit the subject
 *
 * `update(now)` must be called once per frame; the rig never owns the loop.
 */

import * as THREE from "three";

/** Subset of OrbitControls the rig depends on. */
export interface OrbitControlsLike {
  target: THREE.Vector3;
  autoRotate: boolean;
  update: () => void;
  addEventListener: (type: "start", handler: () => void) => void;
  removeEventListener?: (type: "start", handler: () => void) => void;
}

export interface CameraPreset {
  position: [number, number, number];
  target: [number, number, number];
  /** Optional up-vector; needed for true top-down views. */
  up?: [number, number, number];
}

export interface InspectionRigOptions {
  /** Element the canvas lives in — used for picking bounds and aspect maths. */
  container: HTMLElement;
  /** Element that receives pointer events. Defaults to `container`. */
  pointerTarget?: HTMLElement;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControlsLike;
  /** Object subtree to raycast against. */
  pickRoot: THREE.Object3D;
  onPick?: (id: string | null) => void;
  onHover?: (id: string | null) => void;
  /** Tap travel in CSS pixels below which a pointerup counts as a tap. */
  tapSlop?: number;
  /** Tap duration in ms below which a pointerup counts as a tap. */
  tapMs?: number;
}

export interface InspectionRig {
  flyTo: (position: THREE.Vector3, target: THREE.Vector3, durationMs?: number) => void;
  setView: (preset: CameraPreset, durationMs?: number) => void;
  focusOn: (object: THREE.Object3D, durationMs?: number) => void;
  setAutoRotate: (enabled: boolean) => void;
  /** Advance tweens/controls. Call once per frame with a ms timestamp. */
  update: (now: number) => void;
  /** Raycast at a screen point; returns the `partId` userData or null. */
  pickAt: (clientX: number, clientY: number) => string | null;
  screenshot: (
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    filename?: string
  ) => void;
  /** True once the user has touched the camera — use to stop auto-framing. */
  hasInteracted: () => boolean;
  dispose: () => void;
}

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Narrow (portrait phone) canvases need a wider lens to fit the subject. */
export function responsiveFov(container: HTMLElement): number {
  const aspect = container.clientWidth / Math.max(1, container.clientHeight);
  return aspect < 0.9 ? 43 : aspect < 1.3 ? 37 : 32;
}

/** Pull the camera back on portrait canvases so the subject is not cropped. */
export function responsiveScale(container: HTMLElement): number {
  const aspect = container.clientWidth / Math.max(1, container.clientHeight);
  return aspect < 0.9 ? 1.52 : aspect < 1.3 ? 1.2 : 1;
}

/** Apply the responsive FOV, returning true when it actually changed. */
export function applyResponsiveFov(
  camera: THREE.PerspectiveCamera,
  container: HTMLElement
): boolean {
  const nextFov = responsiveFov(container);
  if (Math.abs(camera.fov - nextFov) < 0.1) return false;
  camera.fov = nextFov;
  camera.updateProjectionMatrix();
  return true;
}

export function createInspectionRig(options: InspectionRigOptions): InspectionRig {
  const {
    container,
    camera,
    controls,
    pickRoot,
    onPick,
    onHover,
    tapSlop = 5,
    tapMs = 450,
  } = options;
  const pointerTarget = options.pointerTarget ?? container;

  let tween: {
    fromPosition: THREE.Vector3;
    toPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    start: number;
    duration: number;
  } | null = null;

  let interacted = false;
  let disposed = false;
  let hoverFrame = 0;
  let down = { x: 0, y: 0, time: 0 };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const flyTo = (position: THREE.Vector3, target: THREE.Vector3, durationMs = 820) => {
    tween = {
      fromPosition: camera.position.clone(),
      toPosition: position.clone(),
      fromTarget: controls.target.clone(),
      toTarget: target.clone(),
      start: performance.now(),
      duration: durationMs,
    };
  };

  const setView = (preset: CameraPreset, durationMs = 820) => {
    const target = new THREE.Vector3(...preset.target);
    const position = new THREE.Vector3(...preset.position)
      .sub(target)
      .multiplyScalar(responsiveScale(container))
      .add(target);
    if (preset.up) camera.up.set(...preset.up);
    else camera.up.set(0, 1, 0);
    flyTo(position, target, durationMs);
  };

  const focusOn = (object: THREE.Object3D, durationMs = 860) => {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() * 0.5, 1.4);
    const direction = camera.position.clone().sub(controls.target);
    if (direction.length() < 0.5) direction.set(1, 0.55, 1);
    direction.normalize();
    const distance = THREE.MathUtils.clamp(
      (radius / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))) * 2.15,
      5.5,
      32
    );
    camera.up.set(0, 1, 0);
    flyTo(center.clone().addScaledVector(direction, distance), center, durationMs);
  };

  const findPartId = (object: THREE.Object3D | null): string | null => {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (typeof current.userData.partId === "string") {
        return current.userData.partId as string;
      }
      current = current.parent;
    }
    return null;
  };

  const pickAt = (clientX: number, clientY: number): string | null => {
    const rect = pointerTarget.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    pointer.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(pickRoot, true);
    const hit = hits.find((item) => item.object instanceof THREE.Mesh && item.object.visible);
    return hit ? findPartId(hit.object) : null;
  };

  const onPointerDown = (event: PointerEvent) => {
    down = { x: event.clientX, y: event.clientY, time: performance.now() };
  };

  const onPointerUp = (event: PointerEvent) => {
    const travel = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (travel < tapSlop && performance.now() - down.time < tapMs) {
      const id = pickAt(event.clientX, event.clientY);
      if (id) onPick?.(id);
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      onHover?.(pickAt(event.clientX, event.clientY));
    });
  };

  const onPointerLeave = () => onHover?.(null);

  const onControlsStart = () => {
    interacted = true;
    tween = null;
  };

  pointerTarget.addEventListener("pointerdown", onPointerDown);
  pointerTarget.addEventListener("pointerup", onPointerUp);
  pointerTarget.addEventListener("pointermove", onPointerMove);
  pointerTarget.addEventListener("pointerleave", onPointerLeave);
  controls.addEventListener("start", onControlsStart);

  return {
    flyTo,
    setView,
    focusOn,
    pickAt,
    setAutoRotate: (enabled) => {
      controls.autoRotate = enabled;
    },
    update: (now) => {
      if (disposed) return;
      if (tween) {
        const progress = THREE.MathUtils.clamp((now - tween.start) / tween.duration, 0, 1);
        const eased = easeInOutCubic(progress);
        camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
        controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
        if (progress >= 1) tween = null;
      }
      controls.update();
    },
    screenshot: (renderer, scene, filename) => {
      renderer.render(scene, camera);
      const link = document.createElement("a");
      link.download =
        filename ?? `inspection-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = renderer.domElement.toDataURL("image/png");
      link.click();
    },
    hasInteracted: () => interacted,
    dispose: () => {
      disposed = true;
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      pointerTarget.removeEventListener("pointerdown", onPointerDown);
      pointerTarget.removeEventListener("pointerup", onPointerUp);
      pointerTarget.removeEventListener("pointermove", onPointerMove);
      pointerTarget.removeEventListener("pointerleave", onPointerLeave);
      controls.removeEventListener?.("start", onControlsStart);
      tween = null;
    },
  };
}
