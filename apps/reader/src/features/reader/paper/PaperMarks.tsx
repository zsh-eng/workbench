import { useLayoutEffect, useRef } from "react";
import { cssColourToRgb, tintedGrainTile } from "./page-raster";
import {
  loadedGrain,
  loadPaperGrainImage,
  paperGrainTileSize,
  type PaperGrain,
} from "./paper-grain";
import { pigmentRenderer, type PigmentStroke } from "./pigment-renderer";
import { DARK_THEMES, pixelRatio, themeName } from "./use-page-curl";

const MARKS = 'mark.epub-highlight[data-color]:not([data-color="invisible"])';
/** Room around the strokes for their slanted ends and the ink's bleed. */
const MARGIN = 12;

function seedOf(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  }
  return ((value >>> 0) % 997) + 1;
}

/**
 * The page's highlights as strokes of a pen: one per highlight per line,
 * spanning every mark the line has of it, as a hand draws them.
 */
function strokesOf(page: HTMLElement): PigmentStroke[] {
  const origin = page.getBoundingClientRect();
  const lines = new Map<string, PigmentStroke>();
  const colours = new Map<string, [number, number, number]>();
  for (const mark of page.querySelectorAll<HTMLElement>(MARKS)) {
    const id = mark.dataset.highlightId ?? "";
    const fill = getComputedStyle(mark)
      .getPropertyValue("--highlight-fill")
      .trim();
    if (!fill) continue;
    let colour = colours.get(fill);
    if (!colour) {
      colour = cssColourToRgb(fill);
      colours.set(fill, colour);
    }
    const active = mark.classList.contains("epub-highlight-active");
    for (const rect of mark.getClientRects()) {
      if (rect.width < 0.5 || rect.height < 0.5) continue;
      const top = rect.top - origin.top;
      const key = `${id}@${Math.round(top + rect.height / 2)}`;
      const line = lines.get(key);
      if (line) {
        line.left = Math.min(line.left, rect.left - origin.left);
        line.right = Math.max(line.right, rect.right - origin.left);
        line.top = Math.min(line.top, top);
        line.bottom = Math.max(line.bottom, rect.bottom - origin.top);
        line.active ||= active;
        continue;
      }
      lines.set(key, {
        left: rect.left - origin.left,
        top,
        right: rect.right - origin.left,
        bottom: rect.bottom - origin.top,
        colour,
        active,
        seed: seedOf(key),
        // Each line is its own stroke: the pen lifts at the line's end.
        starts: true,
        ends: true,
      });
    }
  }
  return [...lines.values()];
}

/**
 * The page's highlights as pigment in the paper (Debug paper).
 *
 * The marks keep their place in the page, so hit-testing, selection, the
 * highlight tools and stored offsets work as they always have; once this
 * canvas is drawn, their own fill turns clear and the pigment shows
 * instead, multiplied into the sheet under the text (App.css). It is drawn
 * again when the page's text moves, the theme changes, or a highlight's
 * tools open or close; until then, and wherever WebGL is missing, the
 * marks show their usual fill.
 */
export function PaperMarks({
  grain,
  content,
}: {
  grain: PaperGrain;
  /** Changes whenever the page's text or highlights may have moved. */
  content: unknown;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const page = canvas?.parentElement;
    if (!canvas || !page) return;
    let cancelled = false;
    const hide = () => {
      delete canvas.dataset.ready;
      delete page.dataset.marksReady;
    };
    const draw = (image: HTMLImageElement | null) => {
      if (cancelled || page.offsetWidth === 0) return;
      const strokes = strokesOf(page);
      if (strokes.length === 0) {
        hide();
        return;
      }
      const renderer = pigmentRenderer();
      if (!renderer) return hide();
      const ratio = pixelRatio();
      const left = Math.max(
        0,
        Math.min(...strokes.map((s) => s.left)) - MARGIN,
      );
      const top = Math.max(0, Math.min(...strokes.map((s) => s.top)) - MARGIN);
      const right = Math.min(
        page.offsetWidth,
        Math.max(...strokes.map((s) => s.right)) + MARGIN,
      );
      const bottom = Math.min(
        page.offsetHeight,
        Math.max(...strokes.map((s) => s.bottom)) + MARGIN,
      );
      const tile =
        image && grain !== "off"
          ? tintedGrainTile(
              { image, tile: paperGrainTileSize(grain), colour: "#000" },
              ratio,
            )
          : null;
      const width = right - left;
      const height = bottom - top;
      const painted = renderer.render({
        strokes,
        origin: [left, top],
        width,
        height,
        pixelRatio: ratio,
        dark: DARK_THEMES.includes(themeName()),
        grain:
          tile && grain !== "off"
            ? { tile, size: paperGrainTileSize(grain) }
            : null,
      });
      const context = canvas.getContext("2d");
      if (!painted || !context) return;
      canvas.width = painted.width;
      canvas.height = painted.height;
      canvas.style.left = `${left}px`;
      canvas.style.top = `${top}px`;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.drawImage(painted, 0, 0);
      canvas.dataset.ready = "";
      page.dataset.marksReady = "";
    };
    /**
     * Draws now if the grain and fonts are in, so a page promoted by a turn
     * never shows its marks' flat fill; otherwise once they are.
     */
    const drawWhenReady = () => {
      const image = grain === "off" ? null : loadedGrain(grain);
      if (document.fonts.status === "loaded" && image !== undefined) {
        draw(image);
        return;
      }
      void Promise.all([
        grain === "off" ? null : loadPaperGrainImage(grain),
        document.fonts.ready,
      ]).then(([loaded]) => draw(loaded));
    };
    let frame = 0;
    const redraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(drawWhenReady);
    };
    drawWhenReady();
    // The pigment takes the theme's colours and the page's size, and
    // deepens for the highlight whose tools are open.
    const themes = new MutationObserver(() => {
      hide();
      redraw();
    });
    themes.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    const marks = new MutationObserver((records) => {
      if (records.some((record) => (record.target as Element).matches(MARKS)))
        redraw();
    });
    marks.observe(page, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    let width = page.offsetWidth;
    let height = page.offsetHeight;
    const sizes = new ResizeObserver(() => {
      if (page.offsetWidth === width && page.offsetHeight === height) return;
      width = page.offsetWidth;
      height = page.offsetHeight;
      hide();
      redraw();
    });
    sizes.observe(page);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      themes.disconnect();
      marks.disconnect();
      sizes.disconnect();
      hide();
    };
  }, [content, grain]);

  return (
    <canvas
      ref={canvasRef}
      className="reader-marks-canvas"
      aria-hidden="true"
    />
  );
}
