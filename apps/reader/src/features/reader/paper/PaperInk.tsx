import { useLayoutEffect, useRef } from "react";
import { inkRenderer } from "./ink-renderer";
import { rasterizePage, tintedGrainTile } from "./page-raster";
import {
  loadPaperGrainImage,
  paperGrainTileSize,
  type PaperGrain,
} from "./paper-grain";
import { pixelRatio } from "./use-page-curl";

/**
 * The WebGL ink (Debug): this page's text, soaked into its grain, drawn
 * over the live page, whose own text then turns clear. The live text keeps
 * its place, so selection, links and search work as before; until the ink
 * is drawn, and wherever WebGL is missing, the live text shows.
 */
export function PaperInk({
  grain,
  content,
}: {
  grain: Exclude<PaperGrain, "off">;
  /** Changes whenever the page's text may have moved. */
  content: unknown;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const page = canvas?.parentElement;
    if (!canvas || !page) return;
    let cancelled = false;
    let timer = 0;
    const hide = () => {
      delete canvas.dataset.ready;
      delete page.dataset.inkReady;
    };
    const draw = async () => {
      const [image] = await Promise.all([
        loadPaperGrainImage(grain),
        document.fonts.ready,
      ]);
      if (cancelled || !image || page.offsetWidth === 0) return;
      const ratio = pixelRatio();
      const tile = tintedGrainTile(
        { image, tile: paperGrainTileSize(grain), colour: "#000" },
        ratio,
      );
      const renderer = inkRenderer();
      if (!tile || !renderer) return;
      const ink = rasterizePage(page, {
        pixelRatio: ratio,
        grain: null,
        vignette: null,
        inkOnly: true,
      });
      const soaked = renderer.render(ink, tile, ratio);
      const context = canvas.getContext("2d");
      if (!soaked || !context || cancelled) return;
      canvas.width = ink.width;
      canvas.height = ink.height;
      context.clearRect(0, 0, ink.width, ink.height);
      context.drawImage(soaked, 0, 0);
      canvas.dataset.ready = "";
      page.dataset.inkReady = "";
    };
    const redraw = () => {
      hide();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void draw(), 60);
    };
    redraw();
    // The ink takes the theme's colour and the page's size.
    const themes = new MutationObserver(redraw);
    themes.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    let width = page.offsetWidth;
    let height = page.offsetHeight;
    const sizes = new ResizeObserver(() => {
      if (page.offsetWidth === width && page.offsetHeight === height) return;
      width = page.offsetWidth;
      height = page.offsetHeight;
      redraw();
    });
    sizes.observe(page);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      themes.disconnect();
      sizes.disconnect();
      hide();
    };
  }, [content, grain]);

  return (
    <canvas ref={canvasRef} className="reader-ink-canvas" aria-hidden="true" />
  );
}
