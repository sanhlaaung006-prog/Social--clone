import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  createWarthogAssembly,
  PART_SPECS,
  type LiveryId,
  type LoadoutId,
  type WarthogAssembly,
} from "@/factory/warthog";

export const CAMERA_VIEWS = {
  iso: { label: "ISO", position: [18.6, 8.1, 20.0], target: [0, -0.16, 0] },
  front: { label: "FRONT", position: [0, 2.2, 30], target: [0, 0.28, 0] },
  side: { label: "SIDE", position: [33, 2.0, 0.15], target: [0, 0.05, 0] },
  top: { label: "TOP", position: [0.01, 34, 0.01], target: [0, 0, 0] },
  rear: { label: "REAR", position: [-16, 7, -22], target: [0, -0.1, 0] },
} as const;

export type ViewId = keyof typeof CAMERA_VIEWS;

export interface SceneStats {
  parts: number;
  meshes: number;
  triangles: number;
  materials: number;
}

export interface WarthogScene {
  setSelected: (id: string | null) => void;
  setHovered: (id: string | null) => void;
  setLivery: (id: LiveryId) => void;
  setLoadout: (id: LoadoutId) => void;
  setBlueprint: (enabled: boolean) => void;
  setExplode: (amount: number) => void;
  setAutoRotate: (enabled: boolean) => void;
  setView: (view: ViewId) => void;
  setIsolate: (id: string | null) => void;
  focusPart: (id: string) => void;
  screenshot: () => void;
  stats: SceneStats;
  dispose: () => void;
}

interface SceneCallbacks {
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
}

const FLOOR_Y = -2.27;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function makeBackground(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, "#272c23");
    gradient.addColorStop(0.48, "#1b2019");
    gradient.addColorStop(1, "#10130f");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 512);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createWarthogScene(
  container: HTMLElement,
  callbacks: SceneCallbacks = {}
): WarthogScene {
  const assembly: WarthogAssembly = createWarthogAssembly();
  const scene = new THREE.Scene();
  const background = makeBackground();
  scene.background = background;

  const initialAspect = Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight);
  const camera = new THREE.PerspectiveCamera(
    initialAspect < 0.9 ? 43 : initialAspect < 1.3 ? 37 : 32,
    initialAspect,
    0.1,
    220
  );
  camera.position.set(26, 14.5, 29);

  const responsiveFov = () => {
    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    return aspect < 0.9 ? 43 : aspect < 1.3 ? 37 : 32;
  };
  const responsiveScale = () => {
    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    return aspect < 0.9 ? 1.52 : aspect < 1.3 ? 1.2 : 1;
  };
  let interacted = false;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth || 640, container.clientHeight || 480);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = "warthog-canvas";
  renderer.domElement.setAttribute("aria-label", "Interactive 3D reference model of an A-10C Warthog");
  container.appendChild(renderer.domElement);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentScene = new RoomEnvironment();
  const environmentTarget = pmrem.fromScene(environmentScene, 0.04);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.32;

  // Studio lights
  const hemisphere = new THREE.HemisphereLight(0xe9e6d4, 0x161b14, 0.4);
  scene.add(hemisphere);

  const keyLight = new THREE.DirectionalLight(0xfff4e2, 1.72);
  keyLight.position.set(10, 16, 9);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 55;
  keyLight.shadow.camera.left = -17;
  keyLight.shadow.camera.right = 17;
  keyLight.shadow.camera.top = 17;
  keyLight.shadow.camera.bottom = -17;
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.035;
  keyLight.shadow.radius = 5;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xaebfae, 0.46);
  fillLight.position.set(-14, 8, 7);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xd3e49b, 0.82);
  rimLight.position.set(-5, 6, -15);
  scene.add(rimLight);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(31, 96),
    new THREE.MeshStandardMaterial({
      color: 0x1d211b,
      roughness: 0.9,
      metalness: 0.12,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(38, 38, 0x424a3a, 0x2c332a);
  grid.position.y = FLOOR_Y + 0.012;
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  gridMaterials.forEach((material) => {
    material.transparent = true;
    material.opacity = 0.58;
    material.depthWrite = false;
  });
  scene.add(grid);

  const inspectionRing = new THREE.Mesh(
    new THREE.RingGeometry(9.6, 9.66, 96),
    new THREE.MeshBasicMaterial({
      color: 0x5e6b47,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    })
  );
  inspectionRing.rotation.x = -Math.PI / 2;
  inspectionRing.position.y = FLOOR_Y + 0.02;
  scene.add(inspectionRing);

  const compass = new THREE.Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new THREE.Mesh(
      new THREE.PlaneGeometry(i % 2 === 0 ? 0.8 : 0.4, 0.06),
      new THREE.MeshBasicMaterial({ color: 0x6d7958, side: THREE.DoubleSide })
    );
    tick.rotation.x = -Math.PI / 2;
    tick.rotation.z = (i / 4) * Math.PI * 2;
    tick.position.set(
      Math.sin((i / 4) * Math.PI * 2) * 11.2,
      FLOOR_Y + 0.022,
      Math.cos((i / 4) * Math.PI * 2) * 11.2
    );
    compass.add(tick);
  }
  scene.add(compass);

  scene.add(assembly.root);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.rotateSpeed = 0.72;
  controls.zoomSpeed = 0.8;
  controls.panSpeed = 0.55;
  controls.minDistance = 5.5;
  controls.maxDistance = 55;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = Math.PI / 2 - 0.028;
  controls.target.set(0, -0.2, 0);
  controls.autoRotateSpeed = 0.72;

  // Selection marker
  const selectionBox = new THREE.Box3();
  const selectionHelper = new THREE.Box3Helper(selectionBox, new THREE.Color(0xd4ea77));
  const helperMaterial = selectionHelper.material as THREE.LineBasicMaterial;
  helperMaterial.transparent = true;
  helperMaterial.opacity = 0.55;
  helperMaterial.depthTest = false;
  selectionHelper.renderOrder = 12;
  selectionHelper.visible = false;
  scene.add(selectionHelper);

  // HTML part tag
  const tag = document.createElement("div");
  tag.className = "scene-part-tag";
  tag.setAttribute("aria-hidden", "true");
  container.appendChild(tag);

  let selectedId: string | null = null;
  let hoveredId: string | null = null;
  let boxDirty = true;
  let pointerDown = { x: 0, y: 0, time: 0 };
  let disposed = false;
  let frame = 0;
  let tween:
    | {
        fromPosition: THREE.Vector3;
        toPosition: THREE.Vector3;
        fromTarget: THREE.Vector3;
        toTarget: THREE.Vector3;
        start: number;
        duration: number;
      }
    | null = null;

  const refreshHighlights = () => {
    assembly.parts.forEach((part) => assembly.setHighlight(part.spec.id, 0));
    if (selectedId) assembly.setHighlight(selectedId, 0.24);
    if (hoveredId && hoveredId !== selectedId) assembly.setHighlight(hoveredId, 0.11);
  };

  const updateTag = () => {
    if (!selectedId) {
      tag.style.opacity = "0";
      return;
    }
    const spec = PART_SPECS.find((part) => part.id === selectedId);
    if (!spec) {
      tag.style.opacity = "0";
      return;
    }
    tag.innerHTML =
      `<span class="scene-part-tag__code">${spec.code}</span>` +
      `<span class="scene-part-tag__name">${spec.name}</span>` +
      `<span class="scene-part-tag__category">${spec.category}</span>`;
  };

  const updateSelectionBox = () => {
    if (!selectedId) {
      selectionHelper.visible = false;
      return;
    }
    const part = assembly.parts.get(selectedId);
    if (!part || !part.group.visible) {
      selectionHelper.visible = false;
      return;
    }
    selectionBox.setFromObject(part.group);
    selectionHelper.visible = true;
    boxDirty = false;
  };

  const setSelected = (id: string | null, notify = true) => {
    if (selectedId === id) return;
    selectedId = id;
    boxDirty = true;
    refreshHighlights();
    updateTag();
    if (id) callbacks.onSelect?.(id);
    else if (notify) callbacks.onHover?.(null);
  };

  const setHovered = (id: string | null) => {
    if (hoveredId === id) return;
    hoveredId = id;
    refreshHighlights();
    callbacks.onHover?.(id);
    renderer.domElement.style.cursor = id ? "pointer" : "grab";
  };

  const flyTo = (
    position: THREE.Vector3,
    target: THREE.Vector3,
    duration = 780
  ) => {
    tween = {
      fromPosition: camera.position.clone(),
      toPosition: position.clone(),
      fromTarget: controls.target.clone(),
      toTarget: target.clone(),
      start: performance.now(),
      duration,
    };
  };

  const setView = (view: ViewId) => {
    const preset = CAMERA_VIEWS[view];
    const target = new THREE.Vector3(preset.target[0], preset.target[1], preset.target[2]);
    const scale = responsiveScale();
    const position = new THREE.Vector3(
      preset.position[0],
      preset.position[1],
      preset.position[2]
    );
    position.sub(target).multiplyScalar(scale).add(target);
    camera.up.set(0, view === "top" ? 0 : 1, view === "top" ? -1 : 0);
    flyTo(position, target, 820);
  };

  const focusPart = (id: string) => {
    const part = assembly.parts.get(id);
    if (!part) return;
    const box = new THREE.Box3().setFromObject(part.group);
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
    flyTo(center.clone().addScaledVector(direction, distance), center, 860);
  };

  const setIsolate = (id: string | null) => {
    assembly.setSolo(id);
    boxDirty = true;
  };

  const setExplode = (amount: number) => {
    assembly.setExplode(THREE.MathUtils.clamp(amount, 0, 1));
    boxDirty = true;
  };

  const setBlueprintMode = (enabled: boolean) => {
    assembly.setBlueprint(enabled);
    grid.visible = !enabled;
    inspectionRing.visible = !enabled;
    compass.visible = !enabled;
    floor.visible = !enabled;
  };

  const setLivery = (id: LiveryId) => {
    assembly.setLivery(id);
  };

  const setLoadout = (id: LoadoutId) => {
    assembly.setLoadout(id);
    boxDirty = true;
  };

  const setAutoRotate = (enabled: boolean) => {
    controls.autoRotate = enabled;
  };

  const screenshot = () => {
    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `warthog-a10c-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = dataUrl;
    link.click();
  };

  // Pointer picking
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hoverFrame = 0;

  const findPartId = (object: THREE.Object3D | null): string | null => {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (typeof current.userData.partId === "string") return current.userData.partId as string;
      current = current.parent;
    }
    return null;
  };

  const pick = (event: PointerEvent): string | null => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObject(assembly.root, true);
    const hit = intersects.find(
      (item) => item.object instanceof THREE.Mesh && item.object.visible
    );
    return hit ? findPartId(hit.object) : null;
  };

  const onPointerDown = (event: PointerEvent) => {
    pointerDown = { x: event.clientX, y: event.clientY, time: performance.now() };
  };

  const onPointerUp = (event: PointerEvent) => {
    const travel = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    if (travel < 5 && performance.now() - pointerDown.time < 450) {
      const id = pick(event);
      if (id) setSelected(id);
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      setHovered(pick(event));
    });
  };

  const onPointerLeave = () => setHovered(null);

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerleave", onPointerLeave);
  controls.addEventListener("start", () => {
    interacted = true;
    tween = null;
  });

  // initial framing, widened for portrait canvases
  const intro = CAMERA_VIEWS.iso;
  const introTarget = new THREE.Vector3(intro.target[0], intro.target[1], intro.target[2]);
  const introPosition = new THREE.Vector3(intro.position[0], intro.position[1], intro.position[2]);
  introPosition.sub(introTarget).multiplyScalar(responsiveScale()).add(introTarget);
  flyTo(introPosition, introTarget, 1250);

  const resize = () => {
    if (disposed) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    const nextFov = responsiveFov();
    if (Math.abs(camera.fov - nextFov) > 0.1) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
      if (!interacted) {
        const preset = CAMERA_VIEWS.iso;
        const resizeTarget = new THREE.Vector3(preset.target[0], preset.target[1], preset.target[2]);
        camera.position
          .set(preset.position[0], preset.position[1], preset.position[2])
          .sub(resizeTarget)
          .multiplyScalar(responsiveScale())
          .add(resizeTarget);
        controls.target.copy(resizeTarget);
        tween = null;
      }
    }
    renderer.setSize(width, height, false);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  const animate = (time: number) => {
    if (disposed) return;
    frame = requestAnimationFrame(animate);

    if (tween) {
      const progress = THREE.MathUtils.clamp((time - tween.start) / tween.duration, 0, 1);
      const eased = easeInOutCubic(progress);
      camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
      if (progress >= 1) tween = null;
    }

    if (boxDirty) updateSelectionBox();
    controls.update();
    renderer.render(scene, camera);

    // position the value tag above the selected assembly
    if (selectedId && selectionHelper.visible) {
      const head = selectionBox.getCenter(new THREE.Vector3());
      head.y = selectionBox.max.y + 0.58;
      const projected = head.clone().project(camera);
      const width = container.clientWidth;
      const height = container.clientHeight;
      const onScreen =
        projected.z > -1 &&
        projected.z < 1 &&
        projected.x > -1.12 &&
        projected.x < 1.12 &&
        projected.y > -1.12 &&
        projected.y < 1.12;
      if (onScreen) {
        tag.style.opacity = "1";
        tag.style.transform = `translate(${(projected.x * 0.5 + 0.5) * width}px, ${
          (-projected.y * 0.5 + 0.5) * height
        }px) translate(-50%, -100%)`;
      } else {
        tag.style.opacity = "0";
      }
    } else {
      tag.style.opacity = "0";
    }
  };
  frame = requestAnimationFrame(animate);

  // Kick off the default presentation
  assembly.setLivery("sage");
  assembly.setLoadout("standard");
  assembly.setExplode(0);
  setSelected("fuselage");
  setHovered(null);
  renderer.domElement.style.cursor = "grab";

  const initialStats = assembly.getStats();

  return {
    setSelected: (id) => setSelected(id),
    setHovered,
    setLivery,
    setLoadout,
    setBlueprint: setBlueprintMode,
    setExplode,
    setAutoRotate,
    setView,
    setIsolate,
    focusPart,
    screenshot,
    stats: initialStats,
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frame);
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      assembly.dispose();
      scene.environment = null;
      environmentTarget.dispose();
      pmrem.dispose();
      environmentScene.dispose();
      background.dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      grid.geometry.dispose();
      gridMaterials.forEach((material) => material.dispose());
      inspectionRing.geometry.dispose();
      (inspectionRing.material as THREE.Material).dispose();
      compass.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      selectionHelper.geometry.dispose();
      helperMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      tag.remove();
    },
  };
}
