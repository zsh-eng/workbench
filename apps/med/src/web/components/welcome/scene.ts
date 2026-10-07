import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/** What the Med tile shows. Each pose rearranges the same tiles and bars. */
export type Pose = "logo" | "review" | "agents" | "workspaces" | "notes" | "setup" | "done";

export interface ScenePalette {
  accent: string;
  green: string;
  red: string;
}

export interface WelcomeScene {
  /** Moves to a pose. The object fills the anchor element's box, by the
   * share in its `data-fill` attribute (0.72 by default). */
  show(pose: Pose, anchor: HTMLElement | null): void;
  /** The setup pose draws one line per source; added ones take the accent. */
  setSources(total: number, added: number): void;
  /** Spins the object, for a drag on its anchor. */
  nudge(radians: number): void;
  dispose(): void;
}

interface Bar {
  tile: number;
  x: number;
  y: number;
  /** Distance between the two cap centers. */
  length: number;
  radius?: number;
  /** Rotation in the tile's plane; a quarter turn stands the bar up. */
  angle?: number;
  color: "gray" | "light" | "accent" | "green" | "red";
  delay?: number;
  /** Tile-local start, for bars that fly in. */
  from?: [number, number, number];
  pulse?: boolean;
}
interface Tile {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  scale: number;
}
interface Arrangement {
  tiles: Tile[];
  bars: Bar[];
}

/** The box that the visible tiles cover, in tile units, ignoring their tilt. */
function bounds(plan: Arrangement) {
  const shown = plan.tiles.filter((tile) => tile.scale > 0);
  const left = Math.min(...shown.map((tile) => tile.x - tile.scale));
  const right = Math.max(...shown.map((tile) => tile.x + tile.scale));
  const bottom = Math.min(...shown.map((tile) => tile.y - tile.scale));
  const top = Math.max(...shown.map((tile) => tile.y + tile.scale));
  return {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    width: right - left,
    height: top - bottom,
  };
}

const TILES = 3;
const BARS = 12;
const DEPTH = 0.46;
const RADIUS = 0.075;
const UP = Math.PI / 2;

const hidden: Tile = { x: 0, y: 0, z: -0.6, rx: 0, ry: 0, scale: 0 };
const front: Tile = { x: 0, y: 0, z: 0, rx: 0.16, ry: -0.32, scale: 1 };

// The app icon's four code lines and change bar, in tile units (±1).
const logoBars: Bar[] = [
  { tile: 0, x: -0.024, y: 0.335, length: 0.699, color: "gray" },
  { tile: 0, x: 0.155, y: 0.112, length: 0.748, color: "gray" },
  { tile: 0, x: 0.209, y: -0.112, length: 0.544, color: "accent" },
  { tile: 0, x: -0.192, y: -0.335, length: 0.364, color: "gray" },
  { tile: 0, x: -0.558, y: -0.112, length: 0.126, radius: 0.045, angle: UP, color: "accent" },
];
const line = (tile: number, y: number, start: number, length: number, color: Bar["color"]) => ({
  tile,
  x: start + length / 2,
  y,
  length,
  color,
});

function arrangement(pose: Pose, cycle: number, total: number, added: number): Arrangement {
  if (pose === "review") {
    // A diff: context lines, one removed line, two added lines, and a note.
    const rows: [number, Bar["color"]][] = [
      [0.88, "gray"],
      [1.06, "gray"],
      [0.72, "red"],
      [1.0, "green"],
      [0.8, "green"],
      [0.96, "gray"],
      [0.52, "gray"],
    ];
    const bars: Bar[] = rows.map(([length, color], index) => ({
      ...line(0, 0.62 - index * 0.205, -0.6, length, color),
      delay: index * 0.035,
    }));
    for (const index of [2, 3, 4])
      bars.push({
        tile: 0,
        x: -0.8,
        y: 0.62 - index * 0.205,
        length: 0.09,
        radius: 0.045,
        angle: UP,
        color: rows[index]![1],
        delay: 0.2,
      });
    bars.push(
      { ...line(1, 0.22, -0.55, 1.0, "accent"), radius: 0.11, delay: 0.32 },
      { ...line(1, -0.24, -0.55, 0.6, "light"), radius: 0.11, delay: 0.36 },
    );
    return {
      tiles: [
        { x: -0.18, y: 0.08, z: 0, rx: 0.1, ry: -0.22, scale: 1 },
        { x: 1.05, y: -0.72, z: 0.75, rx: 0.06, ry: -0.3, scale: 0.36 },
        hidden,
      ],
      bars,
    };
  }
  if (pose === "agents") {
    // The agent writes the review line by line; it arrives marked new.
    const bars: Bar[] = logoBars.map((bar, index) => ({
      ...bar,
      from: [3.4, bar.y + 0.5, 0.8],
      delay: 0.1 + index * 0.11,
    }));
    bars.push({
      tile: 0,
      x: 0.72,
      y: 0.72,
      length: 0,
      radius: 0.075,
      color: "accent",
      delay: 0.85,
      pulse: true,
    });
    return { tiles: [front, hidden, hidden], bars };
  }
  if (pose === "workspaces") {
    // Three workspaces in a row, like the switcher; the next one comes forward in turn.
    const slots: Tile[] = [
      { x: 0, y: 0, z: 0.35, rx: 0.1, ry: -0.12, scale: 1 },
      { x: 1.62, y: 0.05, z: -0.7, rx: 0.1, ry: -0.62, scale: 0.66 },
      { x: -1.62, y: 0.05, z: -0.7, rx: 0.1, ry: 0.42, scale: 0.66 },
    ];
    const tiles = [0, 1, 2].map((tile) => slots[(tile + 3 - (cycle % 3)) % 3]!);
    // Each workspace holds different work: a review, a branch, and a note.
    const sets: Bar[][] = [
      logoBars.slice(0, 4),
      [
        line(0, 0.42, -0.55, 1.0, "gray"),
        line(0, 0.14, -0.55, 0.7, "green"),
        line(0, -0.14, -0.55, 0.9, "gray"),
        line(0, -0.42, -0.55, 0.5, "gray"),
      ],
      [
        { ...line(0, 0.42, -0.55, 0.55, "light"), radius: 0.095 },
        line(0, 0.14, -0.55, 1.05, "gray"),
        line(0, -0.14, -0.55, 0.45, "accent"),
        line(0, -0.42, -0.55, 0.85, "gray"),
      ],
    ];
    const bars: Bar[] = sets.flatMap((set, tile) =>
      set.map((bar, index) => ({ ...bar, tile, delay: tile * 0.08 + index * 0.03 })),
    );
    return { tiles, bars };
  }
  if (pose === "notes") {
    // A page of prose with a link in it, and the note it links to.
    return {
      tiles: [
        { x: -0.15, y: 0.06, z: 0, rx: 0.14, ry: -0.28, scale: 1 },
        { x: 1.05, y: 0.7, z: -0.7, rx: 0.14, ry: -0.28, scale: 0.5 },
        hidden,
      ],
      bars: [
        { ...line(0, 0.6, -0.62, 0.5, "light"), radius: 0.095 },
        { ...line(0, 0.3, -0.62, 1.12, "gray"), delay: 0.04 },
        { ...line(0, 0.1, -0.62, 0.32, "gray"), delay: 0.08 },
        { ...line(0, 0.1, -0.07, 0.4, "accent"), delay: 0.1 },
        { ...line(0, 0.1, 0.56, 0.14, "gray"), delay: 0.12 },
        { ...line(0, -0.1, -0.62, 1.0, "gray"), delay: 0.14 },
        { ...line(0, -0.3, -0.62, 1.08, "gray"), delay: 0.16 },
        { ...line(0, -0.5, -0.62, 0.62, "gray"), delay: 0.18 },
        { ...line(1, 0.25, -0.5, 0.8, "light"), radius: 0.12, delay: 0.24 },
        { ...line(1, -0.2, -0.5, 1.0, "accent"), radius: 0.12, delay: 0.28 },
      ],
    };
  }
  if (pose === "setup" && total > 0) {
    // One line per source, up to six; the ones that are added light up.
    const shown = Math.min(total, 6);
    const step = 1.3 / Math.max(shown, 4);
    const lengths = [0.95, 1.1, 0.7, 1.0, 0.82, 0.6];
    const bars: Bar[] = Array.from({ length: shown }, (_, index) => ({
      ...line(0, ((shown - 1) / 2 - index) * step, -0.48, lengths[index]!, "gray"),
      color: index < added ? "accent" : "gray",
      delay: index * 0.04,
    }));
    if (added)
      bars.push({
        tile: 0,
        x: -0.7,
        y: ((shown - 1) / 2) * step - ((Math.min(added, shown) - 1) * step) / 2,
        length: (Math.min(added, shown) - 1) * step,
        radius: 0.045,
        angle: UP,
        color: "accent",
      });
    return { tiles: [front, hidden, hidden], bars };
  }
  return { tiles: [front, hidden, hidden], bars: logoBars };
}

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Builds the welcome scene on a canvas that covers the window. */
export function createScene(canvas: HTMLCanvasElement, palette: ScenePalette): WelcomeScene {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.5;

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  camera.position.set(0, 0, 9);

  const key = new THREE.DirectionalLight(0xfff4ea, 2.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  const rim = new THREE.DirectionalLight(new THREE.Color(palette.accent), 1.4);
  scene.add(key, key.target, rim, rim.target, new THREE.HemisphereLight(0xdfe3ff, 0x15151a, 0.35));

  // The object turns about the centre of what it shows; `content` moves that
  // centre to the origin.
  const object = new THREE.Group();
  const content = new THREE.Group();
  object.add(content);
  scene.add(object);

  const tileGeometry = new RoundedBoxGeometry(2, 2, DEPTH, 10, 0.42);
  const tileMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x18181d,
    roughness: 0.5,
    clearcoat: 0.4,
    clearcoatRoughness: 0.45,
  });
  const tiles = Array.from({ length: TILES }, () => {
    const mesh = new THREE.Mesh(tileGeometry, tileMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.scale.setScalar(0);
    content.add(mesh);
    return mesh;
  });

  const colors = {
    gray: new THREE.Color("#5f5f6c"),
    light: new THREE.Color("#8a8a97"),
    accent: new THREE.Color(palette.accent),
    green: new THREE.Color(palette.green),
    red: new THREE.Color(palette.red),
  };
  const body = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true);
  const cap = new THREE.SphereGeometry(1, 40, 20);
  const bars = Array.from({ length: BARS }, () => {
    const material = new THREE.MeshPhysicalMaterial({
      color: colors.gray.clone(),
      roughness: 0.3,
      clearcoat: 0.5,
      clearcoatRoughness: 0.2,
      emissive: colors.gray.clone(),
      emissiveIntensity: 0,
    });
    const group = new THREE.Group();
    const cylinder = new THREE.Mesh(body, material);
    cylinder.rotation.z = UP;
    const left = new THREE.Mesh(cap, material);
    const right = new THREE.Mesh(cap, material);
    for (const mesh of [cylinder, left, right]) {
      mesh.castShadow = true;
      group.add(mesh);
    }
    group.scale.setScalar(0);
    content.add(group);
    return {
      group,
      cylinder,
      left,
      right,
      material,
      length: 0,
      radius: RADIUS,
      size: 0,
      glow: 0,
      wait: 0,
      pulse: false,
      position: new THREE.Vector3(),
      rotation: new THREE.Quaternion(),
    };
  });

  let pose: Pose = "logo";
  let anchor: HTMLElement | null = null;
  let cycle = 0;
  let cycleAt = 0;
  let sources = { total: 0, added: 0 };
  let plan = arrangement(pose, 0, 0, 0);
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const spin = { angle: 0, velocity: 0, target: 0 };
  const place = { x: 0, y: 0, scale: 0.0001, centerX: 0, centerY: 0, ready: false };
  let still = reduceMotion();
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const onMotion = () => (still = motion.matches);
  motion.addEventListener("change", onMotion);

  const retarget = (entering: boolean) => {
    plan = arrangement(pose, cycle, sources.total, sources.added);
    bars.forEach((bar, index) => {
      const target = plan.bars[index];
      bar.wait = still ? 0 : (target?.delay ?? 0);
      bar.pulse = !!target?.pulse;
      if (entering && target?.from && !still) {
        bar.position.set(...target.from);
        bar.size = 0;
      }
    });
  };

  const resize = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const onPointer = (event: PointerEvent) => {
    pointer.tx = (event.clientX / innerWidth) * 2 - 1;
    pointer.ty = (event.clientY / innerHeight) * 2 - 1;
  };
  addEventListener("pointermove", onPointer);

  // The world box that the anchor element covers, at the object's depth.
  const visibleHeight = () =>
    2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const anchorPlace = () => {
    if (!anchor || !canvas.clientHeight) return null;
    const box = anchor.getBoundingClientRect();
    const view = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    const height = visibleHeight();
    const unit = height / view.height;
    const extent = bounds(plan);
    return {
      x: (box.left + box.width / 2 - view.left - view.width / 2) * unit,
      y: -(box.top + box.height / 2 - view.top - view.height / 2) * unit,
      // Leave room for the tilt, the float, and the perspective.
      // A floor on the extent keeps one tile the same size across poses.
      scale:
        Math.min(
          (box.width * unit) / Math.max(extent.width, 2.5),
          (box.height * unit) / Math.max(extent.height, 2.5),
        ) * (Number(anchor.dataset.fill) || 0.72),
      centerX: extent.x,
      centerY: extent.y,
    };
  };

  const local = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const euler = new THREE.Euler();
  const tileRotation = new THREE.Quaternion();
  const color = new THREE.Color();
  const clock = new THREE.Clock();
  let frame = 0;
  let disposed = false;

  const render = () => {
    frame = 0;
    if (disposed) return;
    const dt = Math.min(clock.getDelta(), 1 / 20);
    const time = clock.elapsedTime;
    const ease = (rate: number) => (still ? 1 : 1 - Math.exp(-dt * rate));

    if (pose === "workspaces" && !still && time - cycleAt > 2.6) {
      cycleAt = time;
      cycle++;
      plan = arrangement(pose, cycle, sources.total, sources.added);
    }

    const target = anchorPlace();
    if (target) {
      if (!place.ready) Object.assign(place, target, { ready: true, scale: target.scale * 0.6 });
      place.x += (target.x - place.x) * ease(6);
      place.y += (target.y - place.y) * ease(6);
      place.scale += (target.scale - place.scale) * ease(6);
      place.centerX += (target.centerX - place.centerX) * ease(6);
      place.centerY += (target.centerY - place.centerY) * ease(6);
    }
    content.position.set(-place.centerX, -place.centerY, 0);
    pointer.x += (pointer.tx - pointer.x) * ease(3);
    pointer.y += (pointer.ty - pointer.y) * ease(3);
    spin.angle += spin.velocity * dt;
    spin.velocity *= Math.exp(-dt * 2.4);
    spin.angle += (spin.target - spin.angle) * ease(2.2);
    const float = still ? 0 : Math.sin(time * 0.9) * 0.045;
    object.position.set(place.x, place.y + float * place.scale, 0);
    object.scale.setScalar(place.scale);
    object.rotation.set(
      (still ? 0 : pointer.y * 0.16) + (still ? 0 : Math.sin(time * 0.5) * 0.03),
      (still ? 0 : pointer.x * 0.26 + Math.sin(time * 0.35) * 0.08) + spin.angle,
      0,
    );

    // Lights follow the object across the window.
    key.position.set(place.x - 3, place.y + 4.5, 6);
    key.target.position.set(place.x, place.y, 0);
    const reach = Math.max(place.scale, 0.2) * 2.6;
    Object.assign(key.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach });
    key.shadow.camera.updateProjectionMatrix();
    rim.position.set(place.x + 4, place.y - 1, -4);
    rim.target.position.set(place.x, place.y, 0);

    tiles.forEach((mesh, index) => {
      const goal = plan.tiles[index] ?? hidden;
      const rate = ease(6.5);
      mesh.position.lerp(local.set(goal.x, goal.y, goal.z), rate);
      tileRotation.setFromEuler(euler.set(goal.rx, goal.ry, 0));
      mesh.quaternion.slerp(tileRotation, rate);
      const scale = mesh.scale.x + (goal.scale - mesh.scale.x) * ease(8);
      mesh.scale.setScalar(scale);
      mesh.visible = scale > 0.01;
    });

    bars.forEach((bar, index) => {
      const goal = plan.bars[index];
      if (bar.wait > 0) {
        bar.wait -= dt;
        return;
      }
      const tile = tiles[goal?.tile ?? 0]!;
      const radius = goal?.radius ?? RADIUS;
      // Bars rest on the tile's face, a little raised, and turn with it.
      local
        .set(goal?.x ?? 0, goal?.y ?? 0, DEPTH / 2 + radius * 0.45)
        .applyQuaternion(tile.quaternion)
        .multiplyScalar(tile.scale.x)
        .add(tile.position);
      bar.position.lerp(local, ease(7));
      turn.setFromAxisAngle(zAxis, goal?.angle ?? 0).premultiply(tile.quaternion);
      bar.rotation.slerp(turn, ease(7));
      const pulse = bar.pulse && !still ? 1 + Math.sin(time * 3.2) ** 2 * 0.22 : 1;
      bar.size += ((goal ? tile.scale.x : 0) * pulse - bar.size) * ease(9);
      bar.length += ((goal?.length ?? 0) - bar.length) * ease(7);
      bar.radius += (radius - bar.radius) * ease(7);
      const tint = colors[goal?.color ?? "gray"];
      bar.material.color.lerp(tint, ease(5));
      const glowing = goal?.color === "accent" || goal?.color === "green" || goal?.color === "red";
      bar.glow += ((glowing ? (bar.pulse ? 0.55 : 0.28) : 0) - bar.glow) * ease(5);
      bar.material.emissive.copy(color.copy(bar.material.color));
      bar.material.emissiveIntensity = bar.glow;

      bar.group.position.copy(bar.position);
      bar.group.quaternion.copy(bar.rotation);
      bar.group.scale.setScalar(bar.size);
      bar.group.visible = bar.size > 0.01;
      bar.cylinder.scale.set(bar.radius, Math.max(bar.length, 0.0001), bar.radius);
      bar.cylinder.visible = bar.length > 0.002;
      bar.left.scale.setScalar(bar.radius);
      bar.right.scale.setScalar(bar.radius);
      bar.left.position.set(-bar.length / 2, 0, 0);
      bar.right.position.set(bar.length / 2, 0, 0);
    });

    renderer.render(scene, camera);
    if (!document.hidden) frame = requestAnimationFrame(render);
  };
  const onVisibility = () => {
    if (!document.hidden && !frame && !disposed) {
      clock.getDelta();
      frame = requestAnimationFrame(render);
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  frame = requestAnimationFrame(render);

  return {
    show(next, element) {
      anchor = element;
      if (next === pose) return;
      const entering = next !== pose;
      if (next === "done" && !still) spin.target += Math.PI * 2;
      pose = next;
      cycle = 0;
      cycleAt = clock.elapsedTime;
      retarget(entering);
    },
    setSources(total, added) {
      if (total === sources.total && added === sources.added) return;
      sources = { total, added };
      if (pose === "setup") retarget(false);
    },
    nudge(radians) {
      if (!still) spin.velocity += radians;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener("change", onMotion);
      removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const bar of bars) bar.material.dispose();
      tileGeometry.dispose();
      tileMaterial.dispose();
      body.dispose();
      cap.dispose();
      environment.dispose();
      room.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
