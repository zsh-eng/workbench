/**
 * Paints a laid-out page into a canvas, for the curl to bend.
 *
 * The page is already laid out in the DOM, so this reads positions rather
 * than laying text out again: each text run is drawn with `fillText` at the
 * place `Range.getClientRects()` reports, in the font, colour and spacing
 * its element computes. Highlights, badges, borders, underlines, images and
 * the paper grain are drawn the same way. Canvas text uses the browser's own
 * shaping and the fonts the page has loaded, so a raster matches the page to
 * within antialiasing; it is only ever seen bent and shaded.
 *
 * Not drawn: CSS gradients and filters other than an image's invert,
 * text shadows, pseudo-element content, and search marks (the Custom
 * Highlight API keeps them outside the DOM).
 */

export interface PageRasterGrain {
  image: HTMLImageElement;
  tile: number;
  colour: string;
}

export interface PageRasterOptions {
  pixelRatio: number;
  grain: PageRasterGrain | null;
  vignette: string | null;
}

const TRANSPARENT = /^(transparent|rgba\(0, 0, 0, 0\)|rgba\(0,0,0,0\))$/;
const SKIPPED = ".reader-paper-grain, .reader-paper-vignette";

function isTransparent(colour: string): boolean {
  return !colour || TRANSPARENT.test(colour.trim());
}

function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fontOf(style: CSSStyleDeclaration): string {
  const caps = style.fontVariantCaps === "small-caps" ? "small-caps " : "";
  return `${style.fontStyle} ${caps}${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

interface FontMetrics {
  ascent: number;
  descent: number;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  rect: DOMRect,
  originX: number,
  originY: number,
  radii: [number, number, number, number],
): void {
  const x = rect.left - originX;
  const y = rect.top - originY;
  context.beginPath();
  if (radii.some((radius) => radius > 0) && "roundRect" in context) {
    context.roundRect(x, y, rect.width, rect.height, radii);
  } else {
    context.rect(x, y, rect.width, rect.height);
  }
  context.fill();
}

function tintedGrainPattern(
  context: CanvasRenderingContext2D,
  grain: PageRasterGrain,
  pixelRatio: number,
): CanvasPattern | null {
  const size = Math.round(grain.tile * pixelRatio);
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const tileContext = tile.getContext("2d");
  if (!tileContext) return null;
  tileContext.drawImage(grain.image, 0, 0, size, size);
  tileContext.globalCompositeOperation = "source-in";
  tileContext.fillStyle = grain.colour;
  tileContext.fillRect(0, 0, size, size);
  try {
    // An SVG image can taint a canvas in some engines; a tainted page could
    // not be uploaded to WebGL, so it goes without grain instead.
    tileContext.getImageData(0, 0, 1, 1);
  } catch {
    return null;
  }
  const pattern = context.createPattern(tile, "repeat");
  pattern?.setTransform(new DOMMatrix().scale(1 / pixelRatio));
  return pattern;
}

function drawImageElement(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  style: CSSStyleDeclaration,
  originX: number,
  originY: number,
): void {
  if (!image.complete || image.naturalWidth === 0) return;
  const rect = image.getBoundingClientRect();
  let { left, top, width, height } = rect;
  if (style.objectFit === "contain") {
    const scale = Math.min(
      width / image.naturalWidth,
      height / image.naturalHeight,
    );
    const drawnWidth = image.naturalWidth * scale;
    const drawnHeight = image.naturalHeight * scale;
    left += (width - drawnWidth) / 2;
    top += (height - drawnHeight) / 2;
    width = drawnWidth;
    height = drawnHeight;
  }
  const x = left - originX;
  const y = top - originY;
  if (!style.filter.includes("invert")) {
    context.drawImage(image, x, y, width, height);
    return;
  }
  // Dark themes invert images; draw the inversion the page shows.
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.drawImage(image, x, y, width, height);
  context.globalCompositeOperation = "difference";
  context.fillStyle = "#fff";
  context.fillRect(x, y, width, height);
  context.restore();
}

/** Draws a hard-edged box shadow such as the note badge's. */
function drawBoxShadow(
  context: CanvasRenderingContext2D,
  shadow: string,
  rect: DOMRect,
  originX: number,
  originY: number,
  radii: [number, number, number, number],
): void {
  if (shadow === "none" || shadow.includes("inset")) return;
  const colour = /^(rgba?\([^)]*\)|oklch\([^)]*\)|color\([^)]*\)|#\w+)/.exec(
    shadow.trim(),
  )?.[0];
  if (!colour) return;
  const [offsetX = 0, offsetY = 0] = shadow
    .slice(colour.length)
    .trim()
    .split(/\s+/)
    .map(px);
  context.fillStyle = colour;
  roundedRect(
    context,
    new DOMRect(
      rect.left + offsetX,
      rect.top + offsetY,
      rect.width,
      rect.height,
    ),
    originX,
    originY,
    radii,
  );
}

function drawBorders(
  context: CanvasRenderingContext2D,
  style: CSSStyleDeclaration,
  rect: DOMRect,
  originX: number,
  originY: number,
): void {
  const sides = [
    ["Top", 0, 0, rect.width, px(style.borderTopWidth)],
    [
      "Bottom",
      0,
      rect.height - px(style.borderBottomWidth),
      rect.width,
      px(style.borderBottomWidth),
    ],
    ["Left", 0, 0, px(style.borderLeftWidth), rect.height],
    [
      "Right",
      rect.width - px(style.borderRightWidth),
      0,
      px(style.borderRightWidth),
      rect.height,
    ],
  ] as const;
  for (const [side, x, y, width, height] of sides) {
    if (width <= 0 || height <= 0) continue;
    if (style.getPropertyValue(`border-${side.toLowerCase()}-style`) === "none")
      continue;
    const colour = style.getPropertyValue(`border-${side.toLowerCase()}-color`);
    if (isTransparent(colour)) continue;
    context.fillStyle = colour;
    context.fillRect(
      rect.left - originX + x,
      rect.top - originY + y,
      width,
      height,
    );
  }
}

/**
 * Rasterises `layer`, a page stage layer, at its own size. Positions are
 * relative to the layer's box, so a layer moved off screen still paints
 * where its page sits.
 */
export function rasterizePage(
  layer: HTMLElement,
  options: PageRasterOptions,
): HTMLCanvasElement {
  const { pixelRatio } = options;
  const origin = layer.getBoundingClientRect();
  const width = layer.offsetWidth;
  const height = layer.offsetHeight;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * pixelRatio));
  canvas.height = Math.max(1, Math.round(height * pixelRatio));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return canvas;
  context.scale(pixelRatio, pixelRatio);

  // The page's own paper: the layer or the spread inside it.
  const paperElements = new Set<Element>();
  let paper = getComputedStyle(layer).backgroundColor;
  paperElements.add(layer);
  const spread = layer.firstElementChild;
  if (isTransparent(paper) && spread) {
    paper = getComputedStyle(spread).backgroundColor;
    paperElements.add(spread);
  }
  context.fillStyle = isTransparent(paper)
    ? getComputedStyle(document.body).backgroundColor
    : paper;
  context.fillRect(0, 0, width, height);

  if (options.grain) {
    const pattern = tintedGrainPattern(context, options.grain, pixelRatio);
    if (pattern) {
      context.fillStyle = pattern;
      context.fillRect(0, 0, width, height);
    }
  }
  if (options.vignette) {
    const gradient = context.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.42,
      width / 2,
      height / 2,
      Math.hypot(width, height) / 2,
    );
    gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(1, options.vignette);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }

  const range = document.createRange();
  const metrics = new Map<string, FontMetrics>();
  const parentStyles = new Map<Element, CSSStyleDeclaration>();
  const supportsLetterSpacing = "letterSpacing" in context;

  const measure = (font: string): FontMetrics => {
    let entry = metrics.get(font);
    if (!entry) {
      context.font = font;
      const sample = context.measureText("Hg");
      entry = {
        ascent: sample.fontBoundingBoxAscent ?? sample.actualBoundingBoxAscent,
        descent:
          sample.fontBoundingBoxDescent ?? sample.actualBoundingBoxDescent,
      };
      metrics.set(font, entry);
    }
    return entry;
  };

  const drawRun = (
    text: string,
    rect: DOMRect,
    font: FontMetrics,
    style: CSSStyleDeclaration,
  ) => {
    const baseline =
      rect.top -
      origin.top +
      (rect.height - (font.ascent + font.descent)) / 2 +
      font.ascent;
    context.fillText(text, rect.left - origin.left, baseline);
    if (!style.textDecorationLine.includes("underline")) return;
    const thickness = Math.max(1, px(style.textDecorationThickness) || 1);
    const offset = px(style.textUnderlineOffset) || px(style.fontSize) * 0.12;
    const colour = style.textDecorationColor;
    if (isTransparent(colour)) return;
    const fill = context.fillStyle;
    context.fillStyle = colour;
    context.fillRect(
      rect.left - origin.left,
      baseline + offset,
      rect.width,
      thickness,
    );
    context.fillStyle = fill;
  };

  const drawText = (node: Text) => {
    const text = node.data;
    if (!text.trim()) return;
    const parent = node.parentElement;
    if (!parent) return;
    let style = parentStyles.get(parent);
    if (!style) {
      style = getComputedStyle(parent);
      parentStyles.set(parent, style);
    }
    if (style.visibility === "hidden" || isTransparent(style.color)) return;
    const font = fontOf(style);
    const fontMetrics = measure(font);
    context.font = font;
    context.fillStyle = style.color;
    if (supportsLetterSpacing) {
      context.letterSpacing =
        style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
    }
    range.selectNodeContents(node);
    const rects = range.getClientRects();
    const spaced = px(style.wordSpacing) !== 0;
    if (rects.length === 1 && !spaced) {
      drawRun(text, rects[0]!, fontMetrics, style);
      return;
    }
    // Justified or wrapped runs: place each word where the page put it.
    for (const match of text.matchAll(/\S+/g)) {
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const wordRects = range.getClientRects();
      if (wordRects.length === 0) continue;
      drawRun(match[0], wordRects[0]!, fontMetrics, style);
    }
  };

  const walker = document.createTreeWalker(
    layer,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node instanceof Element && node.matches(SKIPPED)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) {
      drawText(node);
      continue;
    }
    if (!(node instanceof HTMLElement) || paperElements.has(node)) continue;
    const style = getComputedStyle(node);
    if (style.display === "none") {
      // Skip the subtree by stepping past its last descendant.
      let last: Node = node;
      while (last.lastChild) last = last.lastChild;
      walker.currentNode = last;
      continue;
    }
    if (node instanceof HTMLImageElement) {
      drawImageElement(context, node, style, origin.left, origin.top);
      continue;
    }
    const hasBackground = !isTransparent(style.backgroundColor);
    const hasShadow = style.boxShadow !== "none";
    const hasBorder =
      px(style.borderLeftWidth) +
        px(style.borderRightWidth) +
        px(style.borderTopWidth) +
        px(style.borderBottomWidth) >
      0;
    if (!hasBackground && !hasShadow && !hasBorder) continue;
    const radii: [number, number, number, number] = [
      px(style.borderTopLeftRadius),
      px(style.borderTopRightRadius),
      px(style.borderBottomRightRadius),
      px(style.borderBottomLeftRadius),
    ];
    for (const rect of node.getClientRects()) {
      if (rect.width === 0 || rect.height === 0) continue;
      if (hasShadow)
        drawBoxShadow(
          context,
          style.boxShadow,
          rect,
          origin.left,
          origin.top,
          radii,
        );
      if (hasBackground) {
        context.fillStyle = style.backgroundColor;
        roundedRect(context, rect, origin.left, origin.top, radii);
      }
      if (hasBorder) drawBorders(context, style, rect, origin.left, origin.top);
    }
  }
  range.detach();
  return canvas;
}

/** Converts any CSS colour to 0–1 sRGB, through a one-pixel canvas. */
export function cssColourToRgb(colour: string): [number, number, number] {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [1, 1, 1];
  context.fillStyle = "#fff";
  context.fillStyle = colour;
  context.fillRect(0, 0, 1, 1);
  const [red = 255, green = 255, blue = 255] = context.getImageData(
    0,
    0,
    1,
    1,
  ).data;
  return [red / 255, green / 255, blue / 255];
}
