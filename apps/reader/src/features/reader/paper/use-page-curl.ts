import type { MotionValue } from "motion/react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import {
  computeCurlFold,
  flatPartPolygon,
  turnProgress,
  type CurlFold,
} from "./curl-geometry";
import { CurlRenderer, type CurlLook } from "./curl-renderer";
import {
  cssColourToRgb,
  rasterizePage,
  type PageRasterGrain,
} from "./page-raster";
import {
  loadPaperGrainImage,
  paperGrainTileSize,
  type PaperGrain,
} from "./paper-grain";

export interface PageCurlLayers {
  previous: RefObject<HTMLElement | null>;
  current: RefObject<HTMLElement | null>;
  next: RefObject<HTMLElement | null>;
}

interface UsePageCurlOptions {
  enabled: boolean;
  stageRef: RefObject<HTMLElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  layers: PageCurlLayers;
  dragOffset: MotionValue<number>;
  dragY: MotionValue<number>;
  grabY: MotionValue<number>;
  /** What each layer shows, from `getSpreadContentKey`. */
  keys: {
    previous: string | null;
    current: string | null;
    next: string | null;
  };
  /** True while no turn is in hand, so rasters can be prepared. */
  idle: boolean;
  grain: PaperGrain;
  showThrough: boolean;
}

const DARK_THEMES = ["dark", "night", "flexoki-dark"];
const SHOW_THROUGH = { light: 0.17, dark: 0.22 };

let support: boolean | null = null;

/** Whether this browser can draw the curl; checked once. */
export function isPageCurlSupported(): boolean {
  if (support !== null) return support;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl");
    support = Boolean(gl);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    support = false;
  }
  return support;
}

function pixelRatio(): number {
  return Math.min(3, Math.max(1, window.devicePixelRatio || 1));
}

function themeName(): string {
  const root = document.documentElement;
  for (const name of root.classList) {
    if (
      name === "light" ||
      name === "flexoki-light" ||
      DARK_THEMES.includes(name)
    )
      return name;
  }
  return "light";
}

function hash(text: string): string {
  let value = 5381;
  for (let index = 0; index < text.length; index++) {
    value = ((value << 5) + value + text.charCodeAt(index)) | 0;
  }
  return (value >>> 0).toString(36);
}

/**
 * Identifies one raster: the page, plus what changes its pixels without
 * changing its text (theme, size, type, highlights, paper).
 */
function rasterKey(
  layer: HTMLElement,
  contentKey: string,
  grain: PaperGrain,
): string {
  const firstText = layer.querySelector<HTMLElement>(
    '[data-reader-slice-type="text"]',
  );
  const marks = Array.from(
    layer.querySelectorAll<HTMLElement>("mark[data-highlight-id]"),
    (mark) => `${mark.dataset.highlightId}:${mark.dataset.color}`,
  ).join(",");
  const type = firstText
    ? `${firstText.style.fontFamily}/${firstText.style.fontSize}/${firstText.style.lineHeight}`
    : "";
  return [
    contentKey,
    themeName(),
    `${layer.offsetWidth}x${layer.offsetHeight}@${pixelRatio()}`,
    grain,
    layer.querySelectorAll("[data-reader-page-slice]").length,
    hash(type + marks),
  ].join("|");
}

/**
 * Turns the swipe into a page curl.
 *
 * The swipe hook still owns the gesture, the commit decision and the
 * spring; this hook only presents its offset. Each change is presented in
 * the same task, so a page promoted mid-turn never shows a frame with the
 * old layout:
 *
 * - The page beneath stays live DOM: the next page for a forward turn, the
 *   current page for a backward one.
 * - The turning page stays live DOM up to the crease, clipped there with
 *   `clip-path`; WebGL draws the rest of it bent, from a raster.
 *
 * Rasters are made while the reader rests, for the current page and the
 * previous one, and keyed by content so a promoted page reuses its own.
 */
export function usePageCurl(options: UsePageCurlOptions): void {
  const {
    enabled,
    stageRef,
    canvasRef,
    layers,
    dragOffset,
    dragY,
    grabY,
    keys,
    idle,
    grain,
    showThrough,
  } = options;
  const { previous: previousLayer, current: currentLayer } = layers;
  const { previous: previousKey, current: currentKey } = keys;
  const rendererRef = useRef<CurlRenderer | null>(null);
  const grainRef = useRef<PageRasterGrain | null>(null);
  const lookRef = useRef<{ key: string; look: CurlLook } | null>(null);
  const presentedRef = useRef(false);

  const look = useEffectEvent((layer: HTMLElement): CurlLook => {
    const theme = themeName();
    const cacheKey = `${theme}|${showThrough}`;
    if (lookRef.current?.key === cacheKey) return lookRef.current.look;
    const dark = DARK_THEMES.includes(theme);
    const background = getComputedStyle(
      layer.firstElementChild ?? layer,
    ).backgroundColor;
    const next: CurlLook = {
      paper: cssColourToRgb(background),
      dark,
      showThrough: showThrough
        ? dark
          ? SHOW_THROUGH.dark
          : SHOW_THROUGH.light
        : 0,
    };
    lookRef.current = { key: cacheKey, look: next };
    return next;
  });

  const rasterOptions = useEffectEvent((layer: HTMLElement) => {
    const grainLayer = layer.querySelector<HTMLElement>(".reader-paper-grain");
    const vignette = layer.querySelector<HTMLElement>(".reader-paper-vignette");
    const tile = grainRef.current;
    return {
      pixelRatio: pixelRatio(),
      grain:
        tile && grainLayer
          ? { ...tile, colour: getComputedStyle(grainLayer).backgroundColor }
          : null,
      vignette: vignette
        ? (/(rgba?\([^)]*\)|oklch\([^)]*\)|color\([^)]*\))/.exec(
            getComputedStyle(vignette).boxShadow,
          )?.[0] ?? null)
        : null,
    };
  });

  /** Makes sure the renderer holds this layer's raster; returns its key. */
  const ensureRaster = useEffectEvent(
    (layer: HTMLElement, contentKey: string): string | null => {
      const renderer = rendererRef.current;
      if (!renderer) return null;
      const key = rasterKey(layer, contentKey, grain);
      if (renderer.hasPage(key)) {
        renderer.touchPage(key);
        return key;
      }
      renderer.setPage(key, rasterizePage(layer, rasterOptions(layer)));
      return key;
    },
  );

  const reset = useEffectEvent(() => {
    const previous = layers.previous.current;
    const current = layers.current.current;
    if (previous) {
      previous.style.clipPath = "";
      previous.style.zIndex = "0";
    }
    if (current) current.style.clipPath = "";
    const canvas = canvasRef.current;
    if (canvas) canvas.style.visibility = "hidden";
    rendererRef.current?.clear();
    presentedRef.current = false;
  });

  const present = useEffectEvent(() => {
    const stage = stageRef.current;
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!enabled || !stage || !renderer || !canvas) return;
    const width = stage.offsetWidth;
    const height = stage.offsetHeight;
    const turn = turnProgress(dragOffset.get(), width);
    if (!turn) {
      if (presentedRef.current) reset();
      return;
    }
    const turning =
      turn.side === "next" ? layers.current.current : layers.previous.current;
    const contentKey = turn.side === "next" ? keys.current : keys.previous;
    if (!turning || !contentKey) {
      if (presentedRef.current) reset();
      return;
    }
    renderer.resize(width, height, pixelRatio());
    const key = ensureRaster(turning, contentKey);
    if (!key) return;
    const fold: CurlFold = computeCurlFold({
      width,
      height,
      progress: turn.progress,
      grabY: grabY.get(),
      dragY: dragY.get(),
    });
    const previous = layers.previous.current;
    const current = layers.current.current;
    if (previous) {
      previous.style.zIndex = turn.side === "previous" ? "2" : "0";
      previous.style.clipPath =
        turn.side === "previous" ? flatPartPolygon(fold, width, height) : "";
    }
    if (current) {
      current.style.clipPath =
        turn.side === "next" ? flatPartPolygon(fold, width, height) : "";
    }
    renderer.draw(key, fold, look(turning));
    canvas.style.visibility = "visible";
    presentedRef.current = true;
  });

  // One renderer per stage, on the stage's own canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas) return;
    const renderer = CurlRenderer.create(canvas);
    rendererRef.current = renderer;
    const onLost = (event: Event) => {
      event.preventDefault();
      rendererRef.current = null;
      reset();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      reset();
      renderer?.dispose();
      rendererRef.current = null;
    };
  }, [canvasRef, enabled]);

  useEffect(() => {
    if (grain === "off") {
      grainRef.current = null;
      return;
    }
    let cancelled = false;
    void loadPaperGrainImage(grain).then((image) => {
      if (cancelled) return;
      grainRef.current = image
        ? { image, tile: paperGrainTileSize(grain), colour: "" }
        : null;
    });
    return () => {
      cancelled = true;
    };
  }, [grain]);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribeOffset = dragOffset.on("change", () => present());
    const unsubscribeY = dragY.on("change", () => present());
    return () => {
      unsubscribeOffset();
      unsubscribeY();
    };
  }, [dragOffset, dragY, enabled]);

  // A commit can swap what each layer shows mid-turn; present again before
  // the browser paints the new layers.
  useLayoutEffect(() => {
    if (enabled) present();
  });

  // While the reader rests, prepare the pages a turn will need.
  useEffect(() => {
    if (!enabled || !idle) return;
    const queue: [RefObject<HTMLElement | null>, string | null][] = [
      [currentLayer, currentKey],
      [previousLayer, previousKey],
    ];
    let timer = 0;
    const step = () => {
      const item = queue[0];
      if (!item) return;
      const [layerRef, contentKey] = item;
      const layer = layerRef.current;
      if (!layer || !contentKey) {
        queue.shift();
        timer = window.setTimeout(step, 0);
        return;
      }
      // Wait for images and the outgoing spread, so the raster is the
      // page as it rests.
      if (
        layer.querySelector("[data-reader-image-pending]") ||
        (layerRef === currentLayer && layer.children.length !== 1)
      ) {
        timer = window.setTimeout(step, 200);
        return;
      }
      queue.shift();
      ensureRaster(layer, contentKey);
      timer = window.setTimeout(step, 120);
    };
    timer = window.setTimeout(step, 260);
    return () => window.clearTimeout(timer);
  }, [currentKey, currentLayer, enabled, idle, previousKey, previousLayer]);
}
