import type { LibraryItem } from "../../shared/schema";
import { coverOf } from "./media";
import { articleBody, cardText } from "./text";

export type Density = "comfortable" | "compact";

export interface GridMetrics {
  columns: number;
  colWidth: number;
  gap: number;
  density: Density;
  captioned: boolean;
}

/** Columns follow the content width, not device names. */
export function gridMetrics(width: number, density: Density): GridMetrics {
  const narrow = width < 520;
  const minCol = density === "comfortable" ? (narrow ? 300 : 236) : narrow ? 128 : 156;
  const gap = density === "comfortable" ? (width < 700 ? 16 : 24) : width < 700 ? 8 : 12;
  const columns = Math.max(1, Math.floor((width + gap) / (minCol + gap)));
  const colWidth = Math.floor((width - gap * (columns - 1)) / columns);
  return { columns, colWidth, gap, density, captioned: density === "comfortable" };
}

/** Text card typography. Mirrors .card-text styles in app.css. */
export const TEXT_CARD = {
  comfortable: { size: 15, line: 22, pad: 16, maxLines: 10, title: 19, titleLine: 24, footer: 18 },
  compact: { size: 13.5, line: 19, pad: 12, maxLines: 7, title: 16, titleLine: 20, footer: 16 },
} as const;

export const CAPTION_HEIGHT = 46;
export const TALL_LIMIT = 1.5; // max height / width for media in the grid
export const WIDE_LIMIT = 2.6; // wider images are letterboxed, not cropped

export type Fit = "cover" | "top" | "contain";

export interface Box {
  item: number;
  x: number;
  y: number;
  h: number;
  mediaH: number;
  fit: Fit;
  lines: number;
  titleLines: number;
}

export interface GridLayout {
  metrics: GridMetrics;
  boxes: Box[];
  height: number;
}

// ---------------------------------------------------------------- text measure

// Same stack as --font-text, minus generic keywords that canvas does not resolve.
const FONT_STACK = '"Iowan Old Style", Charter, "New York", Georgia, "Noto Serif", serif';

class Measurer {
  private ctx: CanvasRenderingContext2D;
  private cache = new Map<string, number>();
  private avg: number;
  readonly space: number;
  constructor(readonly size: number, weight = 400) {
    const canvas = document.createElement("canvas");
    this.ctx = canvas.getContext("2d")!;
    this.ctx.font = `${weight} ${size}px ${FONT_STACK}`;
    this.space = this.ctx.measureText(" ").width;
    this.avg = this.ctx.measureText("the quick brown fox jumps over a lazy dog").width / 41;
  }
  word(word: string): number {
    let width = this.cache.get(word);
    if (width === undefined) {
      width = word.length > 40 ? word.length * this.avg : this.ctx.measureText(word).width;
      if (this.cache.size > 20_000) this.cache.clear();
      this.cache.set(word, width);
    }
    return width;
  }
  /** Greedy word wrap, stopping once `limit` lines are reached. */
  lines(text: string, maxWidth: number, limit: number): number {
    let lines = 0;
    for (const paragraph of text.split("\n")) {
      if (!paragraph.trim()) {
        lines++;
        if (lines >= limit) return limit;
        continue;
      }
      let line = 0;
      lines++;
      for (const word of paragraph.split(/ +/)) {
        if (!word) continue;
        const w = this.word(word);
        if (w > maxWidth) {
          // Unbreakable runs (URLs, CJK) wrap anywhere.
          const extra = Math.ceil((line + w) / maxWidth) - 1;
          lines += extra;
          line = (line + w) % maxWidth;
        } else if (line && line + this.space + w > maxWidth) {
          lines++;
          line = w;
        } else {
          line += (line ? this.space : 0) + w;
        }
        if (lines >= limit) return limit;
      }
    }
    return Math.max(1, lines);
  }
}

const measurers = new Map<string, Measurer>();
function measurer(size: number, weight = 400) {
  const key = `${size}/${weight}`;
  let m = measurers.get(key);
  if (!m) measurers.set(key, (m = new Measurer(size, weight)));
  return m;
}

// Text heights depend only on the item, column width and density.
const textCache = new Map<string, { lines: number; titleLines: number }>();

export function textCardLines(item: LibraryItem, colWidth: number, density: Density) {
  const key = `${item.id}:${item.rev}:${colWidth}:${density}`;
  const hit = textCache.get(key);
  if (hit) return hit;
  const spec = TEXT_CARD[density];
  const inner = colWidth - spec.pad * 2;
  const body = cardText(articleBody(item.text, item.articleTitle));
  const titleLines = item.articleTitle ? measurer(spec.title, 600).lines(item.articleTitle, inner, 3) : 0;
  const max = Math.max(3, spec.maxLines - titleLines);
  const lines = body ? measurer(spec.size).lines(body, inner, max) : 0;
  const result = { lines, titleLines };
  if (textCache.size > 30_000) textCache.clear();
  textCache.set(key, result);
  return result;
}

export function textCardHeight(lines: number, titleLines: number, density: Density, hasKicker: boolean) {
  const spec = TEXT_CARD[density];
  let h = spec.pad;
  if (hasKicker) h += 18 + 4;
  if (titleLines) h += titleLines * spec.titleLine + 8;
  h += lines * spec.line;
  h += 12 + spec.footer + spec.pad - 2;
  return Math.round(h);
}

// ---------------------------------------------------------------- masonry

/** Shortest-column masonry; reading order stays close to result order. */
export function computeLayout(items: LibraryItem[], ids: Int32Array, width: number, density: Density): GridLayout {
  const metrics = gridMetrics(width, density);
  const { columns, colWidth, gap, captioned } = metrics;
  const heights = new Array(columns).fill(0);
  const boxes: Box[] = new Array(ids.length);

  for (let k = 0; k < ids.length; k++) {
    const item = items[ids[k]];
    const cover = coverOf(item);
    let h: number;
    let mediaH = 0;
    let fit: Fit = "cover";
    let lines = 0;
    let titleLines = 0;
    if (cover) {
      const aspect = cover.aspect || 1;
      if (aspect < 1 / TALL_LIMIT) {
        mediaH = colWidth * TALL_LIMIT;
        fit = "top";
      } else if (aspect > WIDE_LIMIT) {
        mediaH = colWidth / WIDE_LIMIT;
        fit = "contain";
      } else {
        mediaH = colWidth / aspect;
      }
      mediaH = Math.round(mediaH);
      h = mediaH + (captioned ? CAPTION_HEIGHT : 0);
    } else {
      ({ lines, titleLines } = textCardLines(item, colWidth, density));
      h = textCardHeight(lines, titleLines, density, item.textState === "article");
    }
    let column = 0;
    for (let c = 1; c < columns; c++) if (heights[c] < heights[column] - 1) column = c;
    const x = column * (colWidth + gap);
    const y = heights[column];
    heights[column] = y + h + gap;
    boxes[k] = { item: ids[k], x, y, h, mediaH, fit, lines, titleLines };
  }
  return { metrics, boxes, height: Math.max(0, Math.max(...heights) - gap) };
}

/** Indices of boxes that intersect [top, bottom]. */
export function visibleBoxes(layout: GridLayout, top: number, bottom: number): number[] {
  const out: number[] = [];
  const { boxes } = layout;
  for (let k = 0; k < boxes.length; k++) {
    const b = boxes[k];
    if (b.y < bottom && b.y + b.h > top) out.push(k);
  }
  return out;
}

/** Spatial neighbour for arrow-key navigation in the masonry. */
export function neighbour(layout: GridLayout, from: number, direction: "left" | "right" | "up" | "down"): number {
  const { boxes, metrics } = layout;
  const current = boxes[from];
  if (!current) return from;
  const cx = current.x;
  const cy = current.y + current.h / 2;
  if (direction === "up" || direction === "down") {
    let best = -1;
    let bestY = direction === "down" ? Infinity : -Infinity;
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k];
      if (b.x !== cx || k === from) continue;
      if (direction === "down" && b.y > current.y && b.y < bestY) {
        best = k;
        bestY = b.y;
      }
      if (direction === "up" && b.y < current.y && b.y > bestY) {
        best = k;
        bestY = b.y;
      }
    }
    return best >= 0 ? best : from;
  }
  const step = metrics.colWidth + metrics.gap;
  const targetX = direction === "right" ? cx + step : cx - step;
  let best = -1;
  let bestDistance = Infinity;
  for (let k = 0; k < boxes.length; k++) {
    const b = boxes[k];
    if (Math.abs(b.x - targetX) > 1) continue;
    const distance = Math.abs(b.y + b.h / 2 - cy);
    if (distance < bestDistance) {
      best = k;
      bestDistance = distance;
    }
  }
  return best >= 0 ? best : from;
}
