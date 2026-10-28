/*
 * ═══════════════════════════════════════════════════════════════════
 * FROZEN MODULE — DO NOT EDIT.
 * Ported verbatim (logic unchanged; only ES imports + type annotations
 * added) from the user-supplied standalone "Myanmar, in Relief — One
 * Continuous Terrain" (index.html, received 2026-10-28). Enforced by
 * tests/terrain-lock.test.ts checksums. See locked/LOCKED.md.
 * ═══════════════════════════════════════════════════════════════════
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { clamp, hash2, lerp, mulberry32, smoothstep, TAU } from "./noise";

export type HeightField = (u: number, v: number) => number;

export interface ReliefOptions {
  field: HeightField;
  width?: number;
  depth?: number;
  heightScale?: number;
  segmentsX?: number;
  segmentsZ?: number;
  waterLevel?: number;
  pixelRatioCap?: number;
  drift?: boolean;
  onPick?: ((u: number, v: number, point: THREE.Vector3) => void) | null;
  labelHost?: HTMLElement | null;
}

interface ScatterRules {
  minH?: number;
  maxH?: number;
  maxSlope?: number;
  aboveWater?: number;
}

export interface ScatterOptions {
  name?: string;
  geometry: THREE.BufferGeometry;
  material?: THREE.Material;
  count?: number;
  rules?: ScatterRules;
  size?: { r: [number, number]; h: [number, number] };
  tint?: { base: THREE.ColorRepresentation; dh?: number; ds?: number; dl?: number } | null;
  pivot?: number;
  seed?: number;
}

export interface PlaceOptions {
  yOffset?: number;
  sink?: number;
  alignToSlope?: number;
  rotationY?: number;
}

interface CameraTween {
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  startedAt: number;
  duration: number;
  onFinish: (() => void) | null;
}

interface MapMarker {
  el: HTMLDivElement;
  point: THREE.Vector3;
}

export class ReliefTerrain {
  canvas: HTMLCanvasElement;
  wrap: HTMLElement;
  options: Required<Omit<ReliefOptions, "onPick" | "labelHost">> & {
    onPick: ((u: number, v: number, point: THREE.Vector3) => void) | null;
  };
  field: HeightField;
  labelHost: HTMLElement | null;
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  controls!: OrbitControls;
  groundMesh!: THREE.Mesh;
  waterMesh!: THREE.Mesh;
  structuresGroup!: THREE.Group;
  scatterGroup!: THREE.Group;
  groundRange!: { minH: number; maxH: number };
  private markers: MapMarker[] = [];
  private activeTween: CameraTween | null = null;
  private driftEnabled: boolean;
  private focused = false;
  private waterTime = 0;
  lastAzimuthText = "";
  private clock = new THREE.Clock();
  // Retained verbatim from the source engine's field set.
  // @ts-expect-error TS6133: parity field, the source declares but never reads it.
  private tempVector = new THREE.Vector3();
  private tempProjection = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private pointerStart = { x: 0, y: 0, valid: false };
  private pointerNdc = new THREE.Vector2();

  constructor(canvas: HTMLCanvasElement, wrap: HTMLElement, options: ReliefOptions) {
    this.canvas = canvas;
    this.wrap = wrap;
    this.options = Object.assign({
      width: 130,
      depth: 210,
      heightScale: 3.4,
      segmentsX: 168,
      segmentsZ: 272,
      waterLevel: 0,
      pixelRatioCap: 1.8,
      drift: true,
      onPick: null
    }, options) as ReliefTerrain["options"];
    this.field = options.field;
    this.labelHost = options.labelHost || null;
    this.driftEnabled = this.options.drift;
    this.setupRenderer();
    this.setupScene();
    this.buildGround();
    this.buildWater();
    this.setupControls();
    this.setupLights();
    this.attachPointer();
    this.observeResize();
  }

  /* -- coordinate helpers ---------------------------------------- */
  toUnitX(x: number): number { return x / (this.options.width / 2); }
  toUnitZ(z: number): number { return z / (this.options.depth / 2); }
  toWorldX(u: number): number { return u * (this.options.width / 2); }
  toWorldZ(v: number): number { return v * (this.options.depth / 2); }

  sampleHeight(x: number, z: number): number {
    return this.field(this.toUnitX(x), this.toUnitZ(z)) * this.options.heightScale;
  }

  sampleNormal(x: number, z: number, epsilon = 0.6): THREE.Vector3 {
    const e = epsilon;
    const dx = (this.sampleHeight(x + e, z) - this.sampleHeight(x - e, z)) / (2 * e);
    const dz = (this.sampleHeight(x, z + e) - this.sampleHeight(x, z - e)) / (2 * e);
    return new THREE.Vector3(-dx, 1, -dz).normalize();
  }

  /* -- renderer & scene ------------------------------------------ */
  setupRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.options.pixelRatioCap));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
  }

  setupScene(): void {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0c1510, 340, 1150);
    this.camera = new THREE.PerspectiveCamera(42, 1, 1, 2400);
    this.camera.position.set(0, 180, 330);

    this.structuresGroup = new THREE.Group();
    this.structuresGroup.name = "Structures (atlas.placeStructure)";
    this.scene.add(this.structuresGroup);

    this.scatterGroup = new THREE.Group();
    this.scatterGroup.name = "Scattered instances (atlas.scatter)";
    this.scene.add(this.scatterGroup);
  }

  setupLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xc8dac9, 0x182416, 1.75));

    const sun = new THREE.DirectionalLight(0xfff0d4, 2.75);
    sun.position.set(-150, 220, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.left = -160;
    sun.shadow.camera.right = 160;
    sun.shadow.camera.top = 170;
    sun.shadow.camera.bottom = -170;
    sun.shadow.camera.near = 20;
    sun.shadow.camera.far = 640;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.55;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);

    const fill = new THREE.DirectionalLight(0x91b3a7, 0.72);
    fill.position.set(140, 80, -120);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xc5d6bd, 0.36);
    rim.position.set(0, 40, -200);
    this.scene.add(rim);

    this.scene.add(new THREE.AmbientLight(0x3c5042, 0.34));
  }

  /* -- ground mesh ------------------------------------------------ */
  buildGround(): void {
    const { width, depth, segmentsX, segmentsZ, heightScale } = this.options;
    const baseGeometry = new THREE.PlaneGeometry(width, depth, segmentsX, segmentsZ);
    baseGeometry.rotateX(-Math.PI / 2);
    const positions = baseGeometry.attributes.position;
    let minH = Infinity;
    let maxH = -Infinity;

    for (let i = 0; i < positions.count; i++) {
      const h = this.field(positions.getX(i) / (width / 2), positions.getZ(i) / (depth / 2)) * heightScale;
      positions.setY(i, h);
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }

    const geometry = baseGeometry.toNonIndexed();
    baseGeometry.dispose();
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);

    const stops = [
      { t: 0.0, c: new THREE.Color("#17402c") },
      { t: 0.10, c: new THREE.Color("#2c5539") },
      { t: 0.22, c: new THREE.Color("#55704a") },
      { t: 0.38, c: new THREE.Color("#7d7a52") },
      { t: 0.52, c: new THREE.Color("#8a7c5c") },
      { t: 0.66, c: new THREE.Color("#8d8474") },
      { t: 0.80, c: new THREE.Color("#a29c8f") },
      { t: 0.90, c: new THREE.Color("#c6c5ba") },
      { t: 1.0, c: new THREE.Color("#f2f1e8") }
    ];
    const rockTint = new THREE.Color("#8a8579");
    const sand = new THREE.Color("#b4a67f");
    const seaDeep = new THREE.Color("#0c2827");
    const seaShelf = new THREE.Color("#155049");
    const snow = new THREE.Color("#e9e9e0");
    const color = new THREE.Color();
    const peakH = Math.max(1e-4, maxH);

    for (let i = 0; i < pos.count; i += 3) {
      const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
      const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1);
      const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2);
      const averageHeight = (ay + by + cy) / 3;

      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const normalLength = Math.hypot(nx, ny, nz) || 1;
      const slope = clamp(1 - Math.abs(ny / normalLength), 0, 1);

      const t = clamp(averageHeight / peakH, 0, 1);
      if (averageHeight < 0) {
        color.copy(seaDeep).lerp(seaShelf, clamp((averageHeight + 1.3) / 1.3, 0, 1));
      } else {
        for (let s = 1; s < stops.length; s++) {
          if (t <= stops[s].t) {
            const a = stops[s - 1];
            const b = stops[s];
            color.copy(a.c).lerp(b.c, (t - a.t) / (b.t - a.t));
            break;
          }
        }
        if (averageHeight < 0.075) color.lerp(sand, 0.45);
        if (slope > 0.22 && t < 0.91) {
          color.lerp(rockTint, smoothstep(0.23, 0.68, slope) * 0.52);
        }
        const band = Math.abs(((t * 22) % 1) - 0.5);
        if (band < 0.022 && t > 0.06) color.multiplyScalar(0.91);
        if (t > 0.78 && slope < 0.42) color.lerp(snow, 0.3);
      }

      const faceTint = 0.945 + 0.11 * hash2(
        Math.round(ax * 7) + i * 0.017,
        Math.round(az * 7) - i * 0.011,
        17
      );
      color.multiplyScalar(faceTint);

      for (let k = 0; k < 3; k++) {
        colors[(i + k) * 3] = color.r;
        colors[(i + k) * 3 + 1] = color.g;
        colors[(i + k) * 3 + 2] = color.b;
      }
    }

    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.91,
      metalness: 0,
      side: THREE.FrontSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "Continuous ground (displaced PlaneGeometry)";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    this.groundMesh = mesh;
    this.scene.add(mesh);
    this.groundRange = { minH, maxH };
  }

  buildWater(): void {
    const { width, depth, waterLevel } = this.options;
    const geometry = new THREE.PlaneGeometry(width, depth, 40, 64);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color("#154143") },
        uShallow: { value: new THREE.Color("#3e7771") },
        uOpacity: { value: 0.78 }
      },
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying float vWave;
        void main() {
          vUv = uv;
          vec3 p = position;
          float wave = sin(p.x * 0.32 + uTime * 0.46) * 0.06 +
                       sin(p.z * 0.24 - uTime * 0.33) * 0.05;
          p.y += wave;
          vWave = wave;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        uniform float uOpacity;
        varying vec2 vUv;
        varying float vWave;
        void main() {
          float gradient = clamp(vUv.y * 0.5 + (1.0 - vUv.x) * 0.25 + vWave * 1.6, 0.0, 1.0);
          vec3 color = mix(uDeep, uShallow, gradient);
          float glint = 1.0 - smoothstep(0.0, 0.10, abs(vWave));
          color += vec3(0.022, 0.034, 0.030) * glint;
          gl_FragColor = vec4(color, uOpacity);
          #include <colorspace_fragment>
        }
      `
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = waterLevel;
    mesh.name = "Sea level";
    mesh.frustumCulled = true;
    mesh.renderOrder = 2;
    this.waterMesh = mesh;
    this.scene.add(mesh);
  }

  /* -- structures -------------------------------------------------- */
  placeStructure(object: THREE.Object3D, x: number, z: number, opts: PlaceOptions = {}): THREE.Object3D {
    const { yOffset = 0, sink = 0, alignToSlope = 0, rotationY = 0 } = opts;
    const y = this.sampleHeight(x, z);
    object.position.set(x, y + yOffset - sink, z);
    object.rotation.set(0, rotationY, 0);
    if (alignToSlope > 0) {
      const e = 0.6;
      const dx = (this.sampleHeight(x + e, z) - this.sampleHeight(x - e, z)) / (2 * e);
      const dz = (this.sampleHeight(x, z + e) - this.sampleHeight(x, z - e)) / (2 * e);
      object.rotation.x = Math.atan(dz) * alignToSlope;
      object.rotation.z = -Math.atan(dx) * alignToSlope;
    }
    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.frustumCulled = true;
      }
    });
    this.structuresGroup.add(object);
    return object;
  }

  /* -- instanced scatter ------------------------------------------ */
  scatter(opts: Partial<ScatterOptions> = {}): THREE.InstancedMesh {
    const {
      name = "scatter",
      geometry,
      material,
      count = 200,
      rules = {},
      size = { r: [0.5, 1.1], h: [2.0, 4.5] },
      tint = null,
      pivot = 0.45,
      seed = 1
    } = opts;
    const {
      minH = -Infinity,
      maxH = Infinity,
      maxSlope = 2,
      aboveWater = 0.1
    } = rules;

    const random = mulberry32(seed);
    const placements: Array<{ x: number; y: number; z: number; r: number; hv: number; yaw: number; tilt: number; hue: number }> = [];
    const attempts = count * 18;
    const { width, depth, waterLevel } = this.options;

    for (let attempt = 0; attempt < attempts && placements.length < count; attempt++) {
      const x = (random() * 2 - 1) * (width / 2);
      const z = (random() * 2 - 1) * (depth / 2);
      const h = this.sampleHeight(x, z);
      if (h < waterLevel + aboveWater) continue;
      if (h < minH || h > maxH) continue;
      const e = 0.5;
      const dx = (this.sampleHeight(x + e, z) - this.sampleHeight(x - e, z)) / (2 * e);
      const dz = (this.sampleHeight(x, z + e) - this.sampleHeight(x, z - e)) / (2 * e);
      if (Math.hypot(dx, dz) > maxSlope) continue;
      placements.push({
        x, y: h, z,
        r: lerp(size.r[0], size.r[1], random()),
        hv: lerp(size.h[0], size.h[1], random()),
        yaw: random() * TAU,
        tilt: (random() - 0.5) * 0.12,
        hue: random()
      });
    }

    const mat = material || new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.92, metalness: 0, flatShading: true
    });
    const mesh = new THREE.InstancedMesh(geometry as THREE.BufferGeometry, mat, Math.max(1, placements.length));
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    const color = tint ? new THREE.Color(tint.base) : null;

    placements.forEach((item, index) => {
      position.set(item.x, item.y + item.hv * pivot, item.z);
      euler.set(item.tilt, item.yaw, item.tilt * 0.7, "YXZ");
      quaternion.setFromEuler(euler);
      scale.set(item.r, item.hv, item.r);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      if (color && tint) {
        color.set(tint.base);
        color.offsetHSL(
          (item.hue - 0.5) * (tint.dh || 0.04),
          (item.hue - 0.5) * (tint.ds || 0.1),
          (item.hue - 0.5) * (tint.dl || 0.1)
        );
        mesh.setColorAt(index, color);
      }
    });

    if (placements.length === 0) {
      matrix.makeScale(0, 0, 0);
      mesh.setMatrixAt(0, matrix);
      mesh.setColorAt(0, new THREE.Color("#000000"));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (typeof mesh.computeBoundingSphere === "function") mesh.computeBoundingSphere();
    mesh.userData.instanceCount = placements.length;
    this.scatterGroup.add(mesh);
    return mesh;
  }

  /* -- HTML markers ------------------------------------------------ */
  addMarker({ x, z, title, sub = "", dy = 2 }: { x: number; z: number; title: string; sub?: string; dy?: number }): MapMarker | null {
    if (!this.labelHost) return null;
    const el = document.createElement("div");
    el.className = "map-label";
    el.innerHTML = `<span class="label-dot" aria-hidden="true"></span><span class="label-name">${title}</span>${sub ? `<span class="label-elev">${sub}</span>` : ""}`;
    this.labelHost.appendChild(el);
    const marker = {
      el,
      point: new THREE.Vector3(x, this.sampleHeight(x, z) + dy, z)
    };
    this.markers.push(marker);
    return marker;
  }

  updateMarkers(): void {
    if (!this.labelHost || this.labelHost.classList.contains("is-hidden")) return;
    const rect = this.wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    for (const marker of this.markers) {
      this.tempProjection.copy(marker.point).project(this.camera);
      const p = this.tempProjection;
      const onScreen = p.z > -1 && p.z < 1 &&
        p.x > -1.14 && p.x < 1.14 && p.y > -1.14 && p.y < 1.02;
      if (!onScreen) {
        marker.el.style.opacity = "0";
        continue;
      }
      const screenX = (p.x * 0.5 + 0.5) * rect.width;
      const screenY = (-p.y * 0.5 + 0.5) * rect.height;
      marker.el.style.left = `${screenX.toFixed(1)}px`;
      marker.el.style.top = `${(screenY - 9).toFixed(1)}px`;
      marker.el.style.opacity = "1";
    }
  }

  /* -- controls & framing ------------------------------------------ */
  setupControls(): void {
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.enablePan = false;
    controls.minDistance = 12;
    controls.maxDistance = 780;
    controls.minPolarAngle = 0.22;
    controls.maxPolarAngle = Math.PI * 0.468;
    controls.autoRotate = this.driftEnabled;
    controls.autoRotateSpeed = 0.34;
    controls.rotateSpeed = 0.52;
    controls.zoomSpeed = 0.72;
    controls.target.set(0, 2.5, 0);
    this.controls = controls;
  }

  computeOverviewFrame(): { position: THREE.Vector3; target: THREE.Vector3 } {
    const width = Math.max(320, this.wrap.clientWidth);
    const height = Math.max(260, this.wrap.clientHeight);
    const aspect = width / height;
    const tanFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5);
    const horizontalDistance = ((this.options.width / 2) * 1.08) / (tanFov * aspect);
    const verticalDistance = ((this.options.depth / 2) * 1.10) / tanFov;
    const distance = Math.max(horizontalDistance, verticalDistance, 240);
    const target = new THREE.Vector3(0, 2.5, 6);
    const azimuth = 0.20;
    const elevation = 0.60;
    const horizontal = distance * Math.cos(elevation);
    const position = new THREE.Vector3(
      target.x + Math.sin(azimuth) * horizontal,
      target.y + Math.sin(elevation) * distance,
      target.z + Math.cos(azimuth) * horizontal
    );
    return { position, target };
  }

  flyTo(x: number, z: number, opts: { distance?: number; azimuth?: number | null; polar?: number | null; duration?: number; onFinish?: (() => void) | null } = {}): void {
    const { distance = 70, azimuth = null, polar = null, duration = 980, onFinish = null } = opts;
    const controls = this.controls;
    const theta = azimuth != null ? azimuth : controls.getAzimuthalAngle();
    const phi = polar != null ? polar : clamp(controls.getPolarAngle(), 0.95, 1.2);
    const targetY = clamp(this.sampleHeight(x, z) * 0.4 + 1.2, 1.0, 9);
    const target = new THREE.Vector3(x, targetY, z);
    const spherical = new THREE.Spherical(distance, phi, theta);
    const position = new THREE.Vector3().setFromSpherical(spherical).add(target);
    this.focused = true;
    this.tweenCamera(position, target, duration, () => {
      controls.autoRotate = false;
      if (onFinish) onFinish();
    });
  }

  overview(animate = true): void {
    this.focused = false;
    const frame = this.computeOverviewFrame();
    if (animate) {
      this.tweenCamera(frame.position, frame.target, 980, () => {
        this.controls.autoRotate = this.driftEnabled;
      });
    } else {
      this.camera.position.copy(frame.position);
      this.controls.target.copy(frame.target);
      this.controls.update();
      this.controls.autoRotate = this.driftEnabled;
    }
  }

  tweenCamera(position: THREE.Vector3, target: THREE.Vector3, duration: number, onFinish: (() => void) | null): void {
    this.activeTween = {
      fromPosition: this.camera.position.clone(),
      toPosition: position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
      startedAt: performance.now(),
      duration,
      onFinish
    };
    this.controls.autoRotate = false;
  }

  setDrift(enabled: boolean): void {
    this.driftEnabled = enabled;
    this.controls.autoRotate = enabled && !this.focused && !this.activeTween;
  }

  /* -- interaction -------------------------------------------------- */
  attachPointer(): void {
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (event) => {
      if (this.activeTween) {
        this.activeTween = null;
        this.controls.autoRotate = this.driftEnabled && !this.focused;
      }
      this.pointerStart.x = event.clientX;
      this.pointerStart.y = event.clientY;
      this.pointerStart.valid = true;
    });
    el.addEventListener("pointerup", (event) => {
      if (!this.pointerStart.valid) return;
      const moved = Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y);
      this.pointerStart.valid = false;
      if (moved > 6 || !this.options.onPick) return;
      const rect = el.getBoundingClientRect();
      this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      const hits = this.raycaster.intersectObject(this.groundMesh, false);
      if (hits.length > 0) {
        const point = hits[0].point;
        this.options.onPick!(this.toUnitX(point.x), this.toUnitZ(point.z), point);
      }
    });
    el.addEventListener("pointercancel", () => {
      this.pointerStart.valid = false;
    });
  }

  observeResize(): void {
    this.resize();
    let lastAspect = this.camera.aspect;
    const handle = () => {
      this.resize();
      const nextAspect = this.camera.aspect;
      const aspectShifted = Math.abs(nextAspect - lastAspect) > 0.035;
      if (aspectShifted && !this.focused && !this.activeTween) {
        const frame = this.computeOverviewFrame();
        this.camera.position.copy(frame.position);
        this.controls.target.copy(frame.target);
        this.controls.update();
      }
      lastAspect = nextAspect;
    };
    const ResizeObserverCtor = (
      window as unknown as { ResizeObserver?: typeof ResizeObserver }
    ).ResizeObserver;
    if (ResizeObserverCtor) {
      new ResizeObserverCtor(handle).observe(this.wrap);
    } else {
      window.addEventListener("resize", handle);
    }
  }

  resize(): void {
    const width = Math.max(1, this.wrap.clientWidth);
    const height = Math.max(1, this.wrap.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.options.pixelRatioCap));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /* -- frame loop ---------------------------------------------------- */
  start(onFrame?: (engine: ReliefTerrain) => void): void {
    const loop = () => {
      requestAnimationFrame(loop);
      if (document.hidden) return;
      const delta = Math.min(this.clock.getDelta(), 0.05);
      this.waterTime += delta;
      if (this.waterMesh) (this.waterMesh.material as THREE.ShaderMaterial).uniforms.uTime.value = this.waterTime;

      if (this.activeTween) {
        const t = clamp((performance.now() - this.activeTween.startedAt) / this.activeTween.duration, 0, 1);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        this.camera.position.lerpVectors(this.activeTween.fromPosition, this.activeTween.toPosition, eased);
        this.controls.target.lerpVectors(this.activeTween.fromTarget, this.activeTween.toTarget, eased);
        this.camera.lookAt(this.controls.target);
        if (t >= 1) {
          const finish = this.activeTween.onFinish;
          this.controls.target.copy(this.activeTween.toTarget);
          this.camera.position.copy(this.activeTween.toPosition);
          this.activeTween = null;
          this.controls.update();
          if (finish) finish();
        }
      } else {
        this.controls.update();
      }

      this.updateMarkers();
      if (onFrame) onFrame(this);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }
}
