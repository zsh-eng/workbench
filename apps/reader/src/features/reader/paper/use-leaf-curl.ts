import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import type { LeafView } from "../hooks/use-leaf-turn";
import { flatPartPolygon } from "./curl-geometry";
import { leafGeometry, LeafRenderer, type LeafLook } from "./leaf-renderer";
import {
  cssColourToRgb,
  rasterizePage,
  tintedGrainTile,
  type PageRasterGrain,
} from "./page-raster";
import {
  loadPaperGrainImage,
  paperGrainTileSize,
  type PaperGrain,
} from "./paper-grain";
import {
  DARK_THEMES,
  pixelRatio,
  rasterKey,
  themeName,
  type PageCurlLayers,
} from "./use-page-curl";

interface UseLeafCurlOptions {
  enabled: boolean;
  stageRef: RefObject<HTMLElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  layers: PageCurlLayers;
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
  /** Set to the function that shows a turn; `useLeafTurn` calls it. */
  presenterRef: RefObject<(view: LeafView | null) => void>;
}

const HIDDEN = "polygon(0px 0px, 0px 0px, 0px 0px)";

/**
 * Shows a leaf turn on the stage (Debug curl).
 *
 * The page beneath stays live DOM: the next page under a forward turn, the
 * current page under a backward one. The turning page stays live DOM up to
 * the lift line, clipped there; WebGL draws the rest of it from a raster,
 * with the shade it casts. Rasters are made while the reader rests, for the
 * current page and the previous one, keyed by content.
 */
export function useLeafCurl(options: UseLeafCurlOptions): void {
  const {
    enabled,
    stageRef,
    canvasRef,
    layers,
    keys,
    idle,
    grain,
    showThrough,
    presenterRef,
  } = options;
  const { previous: previousLayer, current: currentLayer } = layers;
  const { previous: previousKey, current: currentKey } = keys;
  const rendererRef = useRef<LeafRenderer | null>(null);
  const grainRef = useRef<PageRasterGrain | null>(null);
  const lookRef = useRef<{ key: string; look: LeafLook } | null>(null);

  const look = useEffectEvent((layer: HTMLElement): LeafLook => {
    const theme = themeName();
    const cacheKey = `${theme}|${showThrough}|${grainRef.current ? grain : "off"}`;
    if (lookRef.current?.key === cacheKey) return lookRef.current.look;
    const background = getComputedStyle(
      layer.firstElementChild ?? layer,
    ).backgroundColor;
    const text = layer.querySelector<HTMLElement>(
      '[data-reader-slice-type="text"]',
    );
    const next: LeafLook = {
      paper: cssColourToRgb(background),
      ink: cssColourToRgb(getComputedStyle(text ?? layer).color),
      dark: DARK_THEMES.includes(theme),
      showThrough,
    };
    // The back of the leaf is the same paper: the same grain, in this theme.
    const tile = grainRef.current;
    const grainLayer = layer.querySelector<HTMLElement>(".reader-paper-grain");
    rendererRef.current?.setGrain(
      tile && grainLayer
        ? tintedGrainTile(
            { ...tile, colour: getComputedStyle(grainLayer).backgroundColor },
            pixelRatio(),
          )
        : null,
      tile?.tile ?? 0,
    );
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

  const show = useEffectEvent(
    (state: { previous: string; current: string; canvas: boolean }) => {
      const previous = layers.previous.current;
      const current = layers.current.current;
      if (previous) {
        previous.style.zIndex = state.previous ? "2" : "0";
        previous.style.clipPath = state.previous === "all" ? "" : state.previous;
      }
      if (current) current.style.clipPath = state.current;
      const canvas = canvasRef.current;
      if (canvas) canvas.style.visibility = state.canvas ? "visible" : "hidden";
      if (!state.canvas) rendererRef.current?.clear();
    },
  );

  const present = useEffectEvent((view: LeafView | null) => {
    if (!view) return show({ previous: "", current: "", canvas: false });
    const stage = stageRef.current;
    if (!enabled || !stage) return;
    if (view.kind === "turned") {
      return show({ previous: "", current: HIDDEN, canvas: false });
    }
    if (view.kind === "laid") {
      return show({ previous: "all", current: "", canvas: false });
    }
    const renderer = rendererRef.current;
    const turning =
      view.page === "current" ? layers.current.current : layers.previous.current;
    const contentKey = view.page === "current" ? keys.current : keys.previous;
    if (!renderer || !turning || !contentKey) {
      return show({ previous: "", current: "", canvas: false });
    }
    const width = stage.offsetWidth;
    const height = stage.offsetHeight;
    renderer.resize(width, height, pixelRatio());
    const key = ensureRaster(turning, contentKey);
    if (!key) return;
    const geometry = leafGeometry(view, width, height);
    if (view.page === "current" && geometry.lift >= width - 0.5) {
      return show({ previous: "", current: "", canvas: false });
    }
    const clip = flatPartPolygon(
      {
        originX: geometry.dirX * geometry.lift,
        originY: geometry.pivotY + geometry.dirY * geometry.lift,
        normalX: geometry.dirX,
        normalY: geometry.dirY,
        radius: 0,
      },
      width,
      height,
    );
    renderer.draw(key, geometry, look(turning));
    show(
      view.page === "current"
        ? { previous: "", current: clip, canvas: true }
        : { previous: clip, current: "", canvas: true },
    );
  });

  useLayoutEffect(() => {
    presenterRef.current = (view) => present(view);
  });

  // One renderer per stage, on the stage's own canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas) return;
    const renderer = LeafRenderer.create(canvas);
    rendererRef.current = renderer;
    lookRef.current = null;
    const onLost = (event: Event) => {
      event.preventDefault();
      rendererRef.current = null;
      present(null);
    };
    canvas.addEventListener("webglcontextlost", onLost);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      present(null);
      renderer?.dispose();
      rendererRef.current = null;
    };
  }, [canvasRef, enabled]);

  useEffect(() => {
    lookRef.current = null;
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
      lookRef.current = null;
    });
    return () => {
      cancelled = true;
    };
  }, [grain]);

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
