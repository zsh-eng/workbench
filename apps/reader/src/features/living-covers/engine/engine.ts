import type { CoverScene } from "../scene";
import { fetchSceneFile } from "../scene-registry";
import { BookRenderer, type BookTextures, type FrameParams } from "./renderer";
import {
  readDragTilt,
  readTilt,
  setSimulatedTilt,
  subscribeTilt,
} from "./tilt";

/**
 * The living-cover engine.
 *
 * - A few WebGL contexts (`MAX_RENDERERS`) move between the covers that are
 *   on screen; their canvases sit inside each cover, so the page scrolls on
 *   the compositor as before. A cover off screen gives its context back.
 * - One frame loop draws only what changed: a new tilt, a cover that moved
 *   on screen, or a scene with life. When nothing changes it stops.
 * - The eye and the light stay in the room while the phone turns. A cover
 *   sees them from its own place on the screen, so a foil title catches the
 *   light as it scrolls past, with or without a gyroscope.
 * - With reduced motion, life stops and each cover holds one still frame.
 */

export type CoverMode = "grid" | "hero";

export type ViewState = "loading" | "ready" | "still" | "idle";

/** What the cover shows: the lit object, or one of its hand-made maps. */
export type DebugView = "lit" | "depth" | "materials";

const DEBUG_VIEWS: Record<DebugView, number> = {
  lit: 0,
  depth: 1,
  materials: 2,
};

export interface LivingViewOptions {
  /** The cover's box on the page. */
  slot: HTMLElement;
  /** Holds the canvas, centred on the slot and larger than it. */
  host: HTMLElement;
  coverUrl: string;
  scene: CoverScene;
  mode: CoverMode;
  pages: number;
  /** `cover` crops the image to the slot, like `object-fit: cover`. */
  fit: "cover" | "fill";
  debugView: DebugView;
  onState: (state: ViewState) => void;
}

export interface LivingViewHandle {
  dispose: () => void;
  setDebugView: (view: DebugView) => void;
}

/** Canvas margin around the cover, in cover widths, for sides and shadow. */
export const CANVAS_PAD: Record<CoverMode, number> = { grid: 0.14, hero: 0.3 };

const MAX_RENDERERS = 8;
const MAX_PIXEL_RATIO = 2;
const QUALITY: Record<CoverMode, { steps: number; shadowSteps: number }> = {
  grid: { steps: 18, shadowSteps: 6 },
  hero: { steps: 36, shadowSteps: 10 },
};
/** Degrees the phone turns at full tilt. */
const TURN = (18 * Math.PI) / 180;
/** A still frame's moment in each scene's life. */
const STILL_TIME = 2.2;

const reducedMotionQuery =
  typeof window === "undefined"
    ? null
    : window.matchMedia("(prefers-reduced-motion: reduce)");

function prefersReducedMotion() {
  return reducedMotionQuery?.matches ?? false;
}

function hasLife(scene: CoverScene) {
  const { shimmer, mist, pulse, glints } = scene.life;
  return Boolean(shimmer || mist || pulse || glints.length > 0);
}

export interface EngineStats {
  frames: number;
  draws: number;
  /** CPU time to submit each draw, in milliseconds; the last 120. */
  drawMs: number[];
  /** Time between frames while the loop runs, in milliseconds; the last 240. */
  frameGaps: number[];
  renderers: number;
  views: number;
  animating: boolean;
}

const stats: EngineStats = {
  frames: 0,
  draws: 0,
  drawMs: [],
  frameGaps: [],
  renderers: 0,
  views: 0,
  animating: false,
};

function push(list: number[], value: number, limit: number) {
  list.push(value);
  if (list.length > limit) list.shift();
}

/**
 * Decode an image off the main thread into a bitmap, so uploading it to a
 * context later costs little. Scene maps keep their exact values.
 */
async function loadImage(url: string, scene: boolean): Promise<TexImageSource> {
  const blob = scene
    ? await (await fetchSceneFile(url)).blob()
    : await (await fetch(url)).blob();
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, {
        premultiplyAlpha: "none",
        colorSpaceConversion: scene ? "none" : "default",
      });
    } catch {
      // Some browsers refuse the options; an image element still works.
    }
  }
  const image = new Image();
  const objectUrl = URL.createObjectURL(blob);
  image.src = objectUrl;
  try {
    await image.decode();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return image;
}

function imageSize(image: TexImageSource): { width: number; height: number } {
  if (image instanceof HTMLImageElement)
    return { width: image.naturalWidth, height: image.naturalHeight };
  return {
    width: (image as ImageBitmap).width,
    height: (image as ImageBitmap).height,
  };
}

class LivingView {
  options: LivingViewOptions;
  visible = false;
  renderer: BookRenderer | null = null;
  images: (BookTextures & { width: number; height: number }) | null = null;
  uploaded = false;
  lastKey = "";
  state: ViewState = "loading";
  releaseTimer = 0;
  disposed = false;

  constructor(options: LivingViewOptions) {
    this.options = options;
    void this.load();
  }

  private async load() {
    const { coverUrl, scene } = this.options;
    try {
      const [cover, depth, materials, life] = await Promise.all([
        loadImage(coverUrl, false),
        scene.maps.depth ? loadImage(scene.maps.depth, true) : null,
        scene.maps.materials ? loadImage(scene.maps.materials, true) : null,
        scene.maps.life ? loadImage(scene.maps.life, true) : null,
      ]);
      if (this.disposed) return;
      this.images = {
        cover,
        depth,
        materials,
        life,
        ...imageSize(cover),
      };
      engine.schedule(this);
    } catch {
      // The plain cover stays: a scene that cannot load is not an error.
      this.setState("idle");
    }
  }

  setState(state: ViewState) {
    if (state === this.state) return;
    this.state = state;
    this.options.onState(state);
  }
}

class Engine {
  private views = new Set<LivingView>();
  private renderers: BookRenderer[] = [];
  private owners = new Map<BookRenderer, LivingView | null>();
  private observer: IntersectionObserver | null = null;
  private frameRequested = false;
  private lastFrame = 0;
  private tilt = { x: 0, y: 0 };
  private started = false;
  private webglAvailable: boolean | null = null;

  private start() {
    if (this.started) return;
    this.started = true;
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const view = [...this.views].find(
            (item) => item.options.slot === entry.target,
          );
          if (!view) continue;
          view.visible = entry.isIntersecting;
          if (view.visible) this.schedule(view);
          else this.releaseLater(view);
        }
      },
      { rootMargin: "80px 0px" },
    );
    const redraw = () => this.requestFrame();
    window.addEventListener("scroll", redraw, { capture: true, passive: true });
    window.addEventListener("resize", redraw, { passive: true });
    reducedMotionQuery?.addEventListener("change", redraw);
    subscribeTilt(redraw);
    // Recordings and tests drive the tilt and read frame times here.
    Object.assign(window, {
      __livingCoverTilt: setSimulatedTilt,
      __livingCoverStats: () => ({
        ...stats,
        renderers: this.renderers.length,
        views: this.views.size,
      }),
    });
  }

  supported(): boolean {
    if (this.webglAvailable === null) {
      try {
        const probe = document.createElement("canvas");
        this.webglAvailable = Boolean(probe.getContext("webgl2"));
        probe
          .getContext("webgl2")
          ?.getExtension("WEBGL_lose_context")
          ?.loseContext();
      } catch {
        this.webglAvailable = false;
      }
    }
    return this.webglAvailable;
  }

  add(options: LivingViewOptions): LivingViewHandle {
    this.start();
    const view = new LivingView(options);
    this.views.add(view);
    this.observer!.observe(options.slot);
    return {
      dispose: () => {
        view.disposed = true;
        window.clearTimeout(view.releaseTimer);
        this.observer?.unobserve(options.slot);
        this.release(view);
        this.views.delete(view);
      },
      setDebugView: (debugView) => {
        view.options.debugView = debugView;
        view.lastKey = "";
        this.requestFrame();
      },
    };
  }

  /** A view is on screen with its images: give it a context and draw. */
  schedule(view: LivingView) {
    window.clearTimeout(view.releaseTimer);
    if (!view.visible || !view.images || view.disposed) return;
    if (!view.renderer) {
      const renderer = this.acquire(view);
      if (!renderer) {
        view.setState("idle");
        return;
      }
      view.renderer = renderer;
      view.uploaded = false;
      view.lastKey = "";
      view.options.host.appendChild(renderer.canvas);
    }
    this.requestFrame();
  }

  private acquire(view: LivingView): BookRenderer | null {
    for (const [renderer, owner] of this.owners) {
      if (!owner && !renderer.lost) {
        this.owners.set(renderer, view);
        return renderer;
      }
    }
    if (this.renderers.length < MAX_RENDERERS) {
      try {
        const canvas = document.createElement("canvas");
        canvas.setAttribute("aria-hidden", "true");
        canvas.style.cssText = "display:block;width:100%;height:100%";
        const renderer = new BookRenderer(canvas);
        this.renderers.push(renderer);
        this.owners.set(renderer, view);
        return renderer;
      } catch {
        this.webglAvailable = false;
        return null;
      }
    }
    // Take a context from a cover that has left the screen.
    for (const [renderer, owner] of this.owners) {
      if (owner && !owner.visible) {
        this.release(owner);
        this.owners.set(renderer, view);
        return renderer;
      }
    }
    return null;
  }

  private releaseLater(view: LivingView) {
    window.clearTimeout(view.releaseTimer);
    // A cover that comes straight back keeps its context.
    view.releaseTimer = window.setTimeout(() => this.release(view), 1500);
  }

  private release(view: LivingView) {
    const renderer = view.renderer;
    if (!renderer) return;
    renderer.canvas.remove();
    // A lost context (iOS drops them in the background) leaves the pool, so
    // a fresh one can take its place.
    if (renderer.lost) {
      this.owners.delete(renderer);
      this.renderers = this.renderers.filter((item) => item !== renderer);
    } else {
      this.owners.set(renderer, null);
    }
    view.renderer = null;
    view.uploaded = false;
    view.setState("idle");
  }

  requestFrame() {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame((now) => this.frame(now));
  }

  private frame(now: number) {
    this.frameRequested = false;
    const dt = this.lastFrame
      ? Math.min((now - this.lastFrame) / 1000, 0.1)
      : 1 / 60;
    if (this.lastFrame && stats.animating)
      push(stats.frameGaps, now - this.lastFrame, 240);
    this.lastFrame = now;
    stats.frames++;

    const reduced = prefersReducedMotion();
    // With reduced motion only a drag turns a book.
    const target = reduced ? (readDragTilt() ?? { x: 0, y: 0 }) : readTilt();
    const follow = 1 - Math.exp(-dt * 9);
    this.tilt.x += (target.x - this.tilt.x) * follow;
    this.tilt.y += (target.y - this.tilt.y) * follow;
    const settling =
      Math.abs(target.x - this.tilt.x) > 0.001 ||
      Math.abs(target.y - this.tilt.y) > 0.001;

    let alive = false;
    let uploaded = false;
    let pending = false;
    for (const view of this.views) {
      const renderer = view.renderer;
      if (!renderer || !view.images || !view.visible) continue;
      if (renderer.lost) {
        this.release(view);
        continue;
      }
      if (!view.uploaded) {
        // One upload per frame, so covers arriving in a fling share frames.
        if (uploaded) {
          pending = true;
          continue;
        }
        renderer.setTextures(view.images);
        view.uploaded = true;
        uploaded = true;
      }
      const living = hasLife(view.options.scene) && !reduced;
      alive ||= living;
      const params = this.params(view, reduced, now / 1000);
      if (!params) continue;
      const key = JSON.stringify([
        params.eye,
        params.light,
        params.yaw,
        params.pitch,
        params.canvas,
        params.view,
      ]);
      // Still covers draw only on change. Life in a grid draws at half rate;
      // a hero book draws every frame.
      const lifeFrame =
        living && (view.options.mode === "hero" || stats.frames % 2 === 0);
      if (key === view.lastKey && !lifeFrame) continue;
      view.lastKey = key;
      const start = performance.now();
      renderer.draw(params);
      push(stats.drawMs, performance.now() - start, 120);
      stats.draws++;
      view.setState(reduced ? "still" : "ready");
    }
    stats.animating = alive || settling;
    if (stats.animating || pending) this.requestFrame();
    else this.lastFrame = 0;
  }

  private params(
    view: LivingView,
    reduced: boolean,
    seconds: number,
  ): FrameParams | null {
    const { slot, scene, mode, fit, pages, host } = view.options;
    const rect = slot.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const images = view.images!;
    const pad = Math.round(rect.width * CANVAS_PAD[mode]);
    const inset = `${-pad}px`;
    if (host.style.inset !== inset) host.style.inset = inset;
    const canvas = {
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
      pixelRatio: Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO),
    };

    // object-fit: cover, as the Library draws covers today.
    let crop: [number, number, number, number] = [0, 0, 1, 1];
    if (fit === "cover") {
      const slotAspect = rect.width / rect.height;
      const imageAspect = images.width / images.height;
      if (imageAspect > slotAspect) {
        const w = slotAspect / imageAspect;
        crop = [(1 - w) / 2, 0, w, 1];
      } else {
        const h = imageAspect / slotAspect;
        crop = [0, (1 - h) / 2, 1, h];
      }
    }

    const thickness =
      rect.width * Math.max(0.035, Math.min(0.2, pages * 0.00034));
    const tilt = this.tilt;
    const turnX = -tilt.x * TURN;
    const turnY = tilt.y * TURN;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let eye: [number, number, number];
    let light: [number, number, number];
    let yaw = 0;
    let pitch = 0;
    if (mode === "hero") {
      // The book turns with the phone; the eye and the lamp stay put.
      const distance = rect.height * 3.4;
      eye = [0, 0, distance];
      light = [-rect.width * 1.1, rect.height * 1.5, distance * 0.8];
      yaw = -turnX * 1.25;
      pitch = turnY;
    } else {
      // The eye and the lamp are in the room; the phone turns under them.
      const distance = Math.max(vw, vh) * 1.6;
      const eyeHome: [number, number, number] = reduced
        ? [0, 0, distance]
        : [vw / 2 - centerX, -(vh * 0.42 - centerY), distance];
      const lampHome: [number, number, number] = reduced
        ? [-rect.width * 2.2, rect.height * 2.6, distance * 0.75]
        : [vw * 0.22 - centerX, -(-vh * 0.32 - centerY), distance * 0.75];
      // Tipping the top toward you lifts the eye toward the top of the page.
      eye = turn(eyeHome, turnX * 0.55, -turnY * 0.55);
      light = turn(lampHome, turnX * 1.3, -turnY * 1.3);
      yaw = 0;
      pitch = 0;
    }
    const quality = QUALITY[mode];
    return {
      canvas,
      book: { width: rect.width, height: rect.height, thickness, pages },
      crop,
      eye,
      light,
      yaw,
      pitch,
      time: reduced ? STILL_TIME : seconds,
      steps: quality.steps,
      shadowSteps: quality.shadowSteps,
      shadow: 1,
      view: DEBUG_VIEWS[view.options.debugView],
      scene,
    };
  }
}

/** Turn a point about the book, as the phone turns under the room. */
function turn(
  point: [number, number, number],
  aroundY: number,
  aroundX: number,
): [number, number, number] {
  const [x, y, z] = point;
  const x1 = x * Math.cos(aroundY) + z * Math.sin(aroundY);
  const z1 = -x * Math.sin(aroundY) + z * Math.cos(aroundY);
  const y2 = y * Math.cos(aroundX) - z1 * Math.sin(aroundX);
  const z2 = y * Math.sin(aroundX) + z1 * Math.cos(aroundX);
  return [x1, y2, z2];
}

export const engine = new Engine();
