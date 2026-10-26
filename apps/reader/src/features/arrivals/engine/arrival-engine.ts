import { compile } from "@/features/living-covers/engine/renderer";
import { fetchSceneFile } from "@/features/living-covers/scene-registry";
import {
  coverKnown,
  shownFraction,
  STAGE_SPANS,
  type ArrivalProgress,
} from "../arrival-progress";
import { ARRIVAL_FRAGMENT, ARRIVAL_VERTEX } from "./arrival-shaders";

/**
 * Draws every arriving cover with one WebGL2 context.
 *
 * - The context renders into one offscreen canvas, a book at a time. Each
 *   book's own canvas sits in its tile and takes the frame as a bitmap
 *   (`transferToImageBitmap`, no copy), so the page scrolls on the
 *   compositor and a menu or focus ring stays above the cover.
 * - One frame loop runs while something moves and stops when all rest.
 *   A book off screen keeps its place in time but is not drawn.
 * - The drawing follows the import, never ahead of it: the share of work
 *   done, plus a creep within a long step. It also keeps a pace, so a fast
 *   import still develops over a second instead of flashing.
 * - A budget: if this loop's own work takes over 4 ms a frame, the engine
 *   gives up for the visit and every arrival draws the calm CSS way.
 */

export type ArrivalDirection = "develop" | "light" | "ink";

const DIRECTIONS: Record<ArrivalDirection, number> = {
  develop: 0,
  light: 1,
  ink: 2,
};

export interface ArrivalFrameInput {
  progress: ArrivalProgress;
  /** `performance.now()` when the progress last changed. */
  changedAt: number;
  cover: Blob | null;
  /** A living cover's depth map, when the book has a hand-made scene. */
  relief: string | null;
  /**
   * The arrival sheet shows this book: it is watched from the first frame,
   * before its view reports that it is on screen.
   */
  watched?: boolean;
}

export interface ArrivalViewOptions {
  /** The arrival's key: its place in time survives a remount. */
  key: string;
  canvas: HTMLCanvasElement;
  /** The cover's box, for its size, its paper and whether it is on screen. */
  slot: HTMLElement;
  direction: ArrivalDirection;
  read(): ArrivalFrameInput;
  /** The cover is drawn as it will stay. */
  onRest(): void;
  /** Draw one moment and hold it, for a still in Design ideas. */
  fixed?: number;
}

export interface ArrivalEngineStats {
  frames: number;
  draws: number;
  /** This loop's CPU time per frame, in ms; the last 240. */
  frameMs: number[];
  /** Time between frames while drawing, in ms; the last 240. */
  frameGaps: number[];
  contexts: number;
  views: number;
  degraded: boolean;
}

const MAX_PIXEL_RATIO = 2;
/** Seconds for the cover to develop when the work is already done. */
const REVEAL_SECONDS = 1.15;
/** The spring under the pace: response in seconds, critically damped. */
const SPRING_RESPONSE = 0.28;
const BUDGET_MS = 4;
const COVER_START = STAGE_SPANS.preparing[0];

const stats: ArrivalEngineStats = {
  frames: 0,
  draws: 0,
  frameMs: [],
  frameGaps: [],
  contexts: 0,
  views: 0,
  degraded: false,
};

function push(list: number[], value: number) {
  list.push(value);
  if (list.length > 240) list.shift();
}

/**
 * One book's place in time and its images, kept across remounts. Several
 * views can show one book (a tile, the arrival sheet, the cover between
 * them); the book advances once a frame and each view draws it.
 */
interface ArrivalState {
  shown: number;
  paced: number;
  velocity: number;
  seed: number;
  /** Drawn at least once on screen: a book never seen does not animate. */
  seen: boolean;
  rested: boolean;
  cover: TextureSlot | null;
  relief: TextureSlot | null;
  lastUsed: number;
}

interface TextureSlot {
  source: Blob | string;
  texture: WebGLTexture | null;
  width: number;
  height: number;
  failed: boolean;
}

interface View {
  options: ArrivalViewOptions;
  state: ArrivalState;
  /** `state.shown` when this view last drew. */
  drawn: number;
  /** `onRest` has run for this view. */
  restTold: boolean;
  present: (frame: Presenter) => void;
  width: number;
  height: number;
  paper: [number, number, number];
  visible: boolean;
  resize: ResizeObserver;
}

type Presenter = OffscreenCanvas | HTMLCanvasElement;

let reducedMotionQuery: MediaQueryList | null | undefined;

/** Whether arrivals may draw with WebGL here, before anything is created. */
export function arrivalEngineSupported(): boolean {
  return engine.supported();
}

export function warmArrivalEngine() {
  engine.warm();
}

class ArrivalEngine {
  private gl: WebGL2RenderingContext | null = null;
  private canvas: Presenter | null = null;
  private program: ReturnType<typeof compile> | null = null;
  private quad: WebGLVertexArrayObject | null = null;
  private empty: WebGLTexture | null = null;
  private views = new Set<View>();
  private states = new Map<string, ArrivalState>();
  private observer: IntersectionObserver | null = null;
  private frameRequested = false;
  private lastFrame = 0;
  private available: boolean | null = null;
  private listeners = new Set<() => void>();
  private lost = false;

  supported(): boolean {
    if (stats.degraded || this.lost) return false;
    if (this.available === null) {
      // A cheap first answer. Making the context is what tells for sure,
      // and if that fails the engine degrades and every cover redraws.
      this.available = typeof WebGL2RenderingContext === "function";
      Object.assign(window, { __arrivalStats: () => ({ ...stats }) });
    }
    return this.available;
  }

  /**
   * Make the context and compile the program while the first file is
   * still being saved, not in the frame that shows the first cover.
   */
  warm() {
    if (this.gl || !this.supported()) return;
    const make = () => void this.context();
    if (typeof window.requestIdleCallback === "function")
      window.requestIdleCallback(make, { timeout: 300 });
    else window.setTimeout(make, 0);
  }

  /** Called when the engine gives up, so each arrival can draw with CSS. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private degrade() {
    if (stats.degraded) return;
    stats.degraded = true;
    for (const listener of this.listeners) listener();
  }

  private context(): WebGL2RenderingContext | null {
    if (this.gl) return this.gl;
    try {
      const canvas: Presenter =
        typeof OffscreenCanvas === "function" &&
        "transferToImageBitmap" in OffscreenCanvas.prototype
          ? new OffscreenCanvas(1, 1)
          : document.createElement("canvas");
      const gl = canvas.getContext("webgl2", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: "low-power",
      }) as WebGL2RenderingContext | null;
      if (!gl) throw new Error("WebGL2 is not available");
      canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        this.lost = true;
        this.degrade();
      });
      this.program = compile(gl, ARRIVAL_VERTEX, ARRIVAL_FRAGMENT);
      this.quad = gl.createVertexArray()!;
      gl.bindVertexArray(this.quad);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
        gl.STATIC_DRAW,
      );
      const location = gl.getAttribLocation(this.program.program, "aPos");
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.empty = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this.empty);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([255, 128, 255, 0]),
      );
      this.gl = gl;
      this.canvas = canvas;
      stats.contexts = 1;
      return gl;
    } catch {
      this.available = false;
      this.degrade();
      return null;
    }
  }

  attach(options: ArrivalViewOptions): () => void {
    const gl = this.context();
    if (!gl) return () => {};
    if (!this.observer) {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            for (const view of this.views) {
              if (view.options.slot !== entry.target) continue;
              view.visible = entry.isIntersecting;
            }
          }
          this.requestFrame();
        },
        { rootMargin: "120px 0px" },
      );
    }
    let state = this.states.get(options.key);
    if (!state) {
      state = {
        shown: 0,
        paced: 0,
        velocity: 0,
        seed: Math.random(),
        seen: false,
        rested: false,
        cover: null,
        relief: null,
        lastUsed: performance.now(),
      };
      this.states.set(options.key, state);
    }
    const bitmap = this.canvas instanceof OffscreenCanvas;
    const target = options.canvas.getContext(
      bitmap ? "bitmaprenderer" : "2d",
    ) as ImageBitmapRenderingContext | CanvasRenderingContext2D | null;
    const view: View = {
      options,
      state,
      drawn: -1,
      restTold: false,
      width: 0,
      height: 0,
      paper: readPaper(options.slot),
      visible: false,
      present: (source) => {
        if (target instanceof ImageBitmapRenderingContext) {
          target.transferFromImageBitmap(
            (source as OffscreenCanvas).transferToImageBitmap(),
          );
        } else if (target) {
          target.clearRect(0, 0, options.canvas.width, options.canvas.height);
          target.drawImage(source as HTMLCanvasElement, 0, 0);
        }
      },
      resize: new ResizeObserver(([entry]) => {
        if (!entry) return;
        view.width = entry.contentRect.width;
        view.height = entry.contentRect.height;
        view.drawn = -1;
        this.requestFrame();
      }),
    };
    const rect = options.slot.getBoundingClientRect();
    view.width = rect.width;
    view.height = rect.height;
    view.visible = rect.bottom > -120 && rect.top < window.innerHeight + 120;
    view.resize.observe(options.slot);
    this.observer.observe(options.slot);
    this.views.add(view);
    stats.views = this.views.size;
    // A remounted tile shows its current frame before it paints. A book
    // already at rest tells the new view so in the next frame.
    this.drawView(view);
    this.requestFrame();
    return () => {
      view.resize.disconnect();
      this.observer?.unobserve(options.slot);
      this.views.delete(view);
      stats.views = this.views.size;
      view.state.lastUsed = performance.now();
      this.collectLater();
    };
  }

  private collectTimer = 0;

  /** Textures of books no tile shows for a while go back to the GPU. */
  private collectLater() {
    window.clearTimeout(this.collectTimer);
    this.collectTimer = window.setTimeout(() => {
      const gl = this.gl;
      if (!gl) return;
      const now = performance.now();
      const used = new Set([...this.views].map((view) => view.state));
      for (const [key, state] of this.states) {
        if (used.has(state) || now - state.lastUsed < 20_000) continue;
        if (state.cover?.texture) gl.deleteTexture(state.cover.texture);
        if (state.relief?.texture) gl.deleteTexture(state.relief.texture);
        this.states.delete(key);
      }
    }, 21_000);
  }

  /** The import reported: look again. */
  wake() {
    this.requestFrame();
  }

  requestFrame() {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame((now) => this.frame(now));
  }

  private frame(now: number) {
    this.frameRequested = false;
    const start = performance.now();
    // A long frame (the import's own work) must not make the drawing jump.
    const dt = this.lastFrame
      ? Math.min((now - this.lastFrame) / 1000, 1 / 30)
      : 1 / 60;
    if (this.lastFrame) push(stats.frameGaps, now - this.lastFrame);
    stats.frames++;
    let moving = false;
    const books = new Map<ArrivalState, View[]>();
    for (const view of this.views) {
      const views = books.get(view.state);
      if (views) views.push(view);
      else books.set(view.state, [view]);
    }
    for (const [state, views] of books)
      if (this.step(state, views, dt, now)) moving = true;
    const spent = performance.now() - start;
    push(stats.frameMs, spent);
    if (stats.frameMs.length >= 30) {
      const recent = stats.frameMs.slice(-30).sort((a, b) => a - b);
      if (recent[15]! > BUDGET_MS) this.degrade();
    }
    if (moving && !stats.degraded) {
      this.lastFrame = now;
      this.requestFrame();
    } else {
      this.lastFrame = 0;
    }
  }

  /**
   * Advance one book, then draw each of its views that is on screen. True
   * while it moves.
   */
  private step(
    state: ArrivalState,
    views: View[],
    dt: number,
    now: number,
  ): boolean {
    const input = views[0]!.options.read();
    state.lastUsed = now;
    this.loadTextures(state, input);
    const fixed = views.find((view) => view.options.fixed !== undefined);
    if (fixed) {
      state.shown = fixed.options.fixed!;
      this.drawViews(state, views);
      return false;
    }
    const moving = state.rested
      ? false
      : this.advance(state, views, input, dt, now);
    this.drawViews(state, views);
    if (state.rested)
      for (const view of views) {
        if (view.restTold) continue;
        view.restTold = true;
        view.options.onRest();
      }
    return moving;
  }

  private drawViews(state: ArrivalState, views: View[]) {
    for (const view of views) {
      if (!view.visible) continue;
      const behind = Math.abs(state.shown - view.drawn);
      if (behind > 0.0004 || (behind > 0 && state.rested)) {
        this.drawView(view);
        state.seen = true;
      }
    }
  }

  /** Move the book's place in time towards the import. */
  private advance(
    state: ArrivalState,
    views: View[],
    input: ArrivalFrameInput,
    dt: number,
    now: number,
  ): boolean {
    const { stage } = input.progress;
    const ready = stage === "ready";
    // A book that finished while nobody saw it arrives at rest.
    const seen = input.watched || views.some((view) => view.visible);
    if (ready && !state.seen && !seen) {
      state.shown = state.paced = 1;
      state.rested = true;
      return false;
    }
    // The cover cannot develop before the import has found it.
    const ceiling = coverKnown(stage) ? 1 : COVER_START;
    const goal = Math.min(
      ceiling,
      shownFraction(input.progress, (now - input.changedAt) / 1000),
    );
    // Paper shows nothing of the steps before the cover, so they need no
    // pace; from the cover on, the drawing keeps one.
    if (goal >= COVER_START && state.shown < COVER_START) {
      state.paced = state.shown = COVER_START;
      state.velocity = 0;
    }
    const pace = (1 - COVER_START) / REVEAL_SECONDS;
    state.paced = Math.max(
      state.paced,
      Math.min(goal, state.paced + pace * dt),
    );
    const omega = (2 * Math.PI) / SPRING_RESPONSE;
    state.velocity +=
      (omega * omega * (state.paced - state.shown) -
        2 * omega * state.velocity) *
      dt;
    state.shown = Math.min(1, state.shown + state.velocity * dt);
    const resting =
      Math.abs(state.paced - state.shown) < 0.002 &&
      Math.abs(state.velocity) < 0.01;
    if (ready && state.paced >= 1 && resting) {
      state.shown = 1;
      state.rested = true;
      return false;
    }
    // A working step creeps on; a queued, failed or duplicate one waits.
    const working =
      stage === "saving" || stage === "reading" || stage === "preparing";
    return !resting || state.paced < goal || working || ready;
  }

  private loadTextures(state: ArrivalState, input: ArrivalFrameInput) {
    if (input.cover && state.cover?.source !== input.cover) {
      const slot: TextureSlot = {
        source: input.cover,
        texture: null,
        width: 0,
        height: 0,
        failed: false,
      };
      state.cover = slot;
      void this.upload(slot, input.cover, true);
    }
    if (input.relief && state.relief?.source !== input.relief) {
      const slot: TextureSlot = {
        source: input.relief,
        texture: null,
        width: 0,
        height: 0,
        failed: false,
      };
      state.relief = slot;
      void (async () => {
        try {
          const blob = await (await fetchSceneFile(input.relief!)).blob();
          await this.upload(slot, blob, false);
        } catch {
          slot.failed = true;
        }
      })();
    }
  }

  /** Decode off the main thread at about the size it shows, then upload. */
  private async upload(slot: TextureSlot, blob: Blob, color: boolean) {
    try {
      let bitmap = await createImageBitmap(blob, {
        premultiplyAlpha: "none",
        colorSpaceConversion: color ? "default" : "none",
      });
      // Covers can be large; a book shows at most a few hundred pixels wide.
      const widest = 720;
      if (color && bitmap.width > widest) {
        const resized = await createImageBitmap(bitmap, {
          resizeWidth: widest,
          resizeHeight: Math.round((bitmap.height / bitmap.width) * widest),
          resizeQuality: "high",
        });
        bitmap.close();
        bitmap = resized;
      }
      const gl = this.gl;
      if (!gl) return;
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(
        gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
        color ? gl.BROWSER_DEFAULT_WEBGL : gl.NONE,
      );
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bitmap,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        gl.LINEAR_MIPMAP_LINEAR,
      );
      slot.width = bitmap.width;
      slot.height = bitmap.height;
      slot.texture = texture;
      bitmap.close();
      // Draw the views of this book again now that the image is in.
      for (const view of this.views)
        if (view.state.cover === slot || view.state.relief === slot)
          view.drawn = -1;
      this.requestFrame();
    } catch {
      slot.failed = true;
    }
  }

  private drawView(view: View) {
    const gl = this.gl;
    const canvas = this.canvas;
    const program = this.program;
    if (!gl || !canvas || !program || gl.isContextLost()) return;
    const { state, options } = view;
    if (view.width < 2 || view.height < 2) return;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const width = Math.round(view.width * ratio);
    const height = Math.round(view.height * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (options.canvas.width !== width || options.canvas.height !== height) {
      options.canvas.width = width;
      options.canvas.height = height;
    }
    const cover = state.cover?.texture ? state.cover : null;
    const relief = state.relief?.texture ? state.relief : null;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cover?.texture ?? this.empty);
    gl.uniform1i(program.uniform("uCover"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, relief?.texture ?? this.empty);
    gl.uniform1i(program.uniform("uRelief"), 1);
    gl.uniform2f(program.uniform("uHas"), cover ? 1 : 0, relief ? 1 : 0);
    gl.uniform4fv(
      program.uniform("uCrop"),
      cover ? coverCrop(view.width / view.height, cover) : [0, 0, 1, 1],
    );
    gl.uniform2f(program.uniform("uSize"), view.width, view.height);
    const reveal = Math.max(0, (state.shown - COVER_START) / (1 - COVER_START));
    gl.uniform1f(program.uniform("uReveal"), reveal);
    gl.uniform1f(
      program.uniform("uBefore"),
      Math.min(1, state.shown / COVER_START),
    );
    gl.uniform3fv(program.uniform("uPaper"), view.paper);
    gl.uniform1f(program.uniform("uSeed"), state.seed);
    gl.uniform1i(program.uniform("uDirection"), DIRECTIONS[options.direction]);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    view.present(canvas);
    view.drawn = state.shown;
    stats.draws++;
  }
}

/** `object-fit: cover`, as the Library draws covers. */
function coverCrop(
  slotAspect: number,
  image: { width: number; height: number },
): [number, number, number, number] {
  const imageAspect = image.width / image.height;
  if (imageAspect > slotAspect) {
    const w = slotAspect / imageAspect;
    return [(1 - w) / 2, 0, w, 1];
  }
  const h = imageAspect / slotAspect;
  return [0, (1 - h) / 2, 1, h];
}

/** The slot's paper colour, as sRGB from 0 to 1, whatever the theme. */
const papers = new Map<string, [number, number, number]>();
let paperProbe: CanvasRenderingContext2D | null | undefined;

function readPaper(slot: HTMLElement): [number, number, number] {
  const colour = getComputedStyle(slot).backgroundColor || "#f7f7f7";
  const known = papers.get(colour);
  if (known) return known;
  if (paperProbe === undefined) {
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    paperProbe = probe.getContext("2d", { willReadFrequently: true });
  }
  if (!paperProbe) return [0.97, 0.97, 0.97];
  // The canvas turns any CSS colour, oklch included, into sRGB bytes.
  paperProbe.fillStyle = colour;
  paperProbe.fillRect(0, 0, 1, 1);
  const [r, g, b] = paperProbe.getImageData(0, 0, 1, 1).data;
  const paper: [number, number, number] = [r! / 255, g! / 255, b! / 255];
  papers.set(colour, paper);
  return paper;
}

export function prefersReducedMotion(): boolean {
  reducedMotionQuery ??=
    typeof window === "undefined"
      ? null
      : window.matchMedia("(prefers-reduced-motion: reduce)");
  return reducedMotionQuery?.matches ?? false;
}

export const engine = new ArrivalEngine();
