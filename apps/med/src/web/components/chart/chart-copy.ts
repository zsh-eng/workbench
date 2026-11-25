import { backdropOf, COPY_PAD, standaloneSvg, svgPng } from "../../markdown/copy";

const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const round = (value: number) => Math.round(value * 100) / 100;

/** A piece of the picture: where it sits on the page, and its SVG there. */
type Part = { box: DOMRectReadOnly; draw(x: number, y: number): string };

const shown = (element: Element) =>
  element.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true;

let measure: CanvasRenderingContext2D | undefined;

/** How far a line's baseline sits below the top of its text box, as the page lays it out. */
function baseline(style: CSSStyleDeclaration, text: string, height: number) {
  measure ??= document.createElement("canvas").getContext("2d")!;
  measure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } =
    measure.measureText(text);
  if (!ascent) return height * 0.78;
  return (height - ascent - descent) / 2 + ascent;
}

/**
 * Each line of an element's text, at its place and in its look: a title that
 * wraps on the page wraps in the picture, and nothing is measured twice.
 */
function textParts(root: Element, skip?: string): Part[] {
  const parts: Part[] = [];
  const edge = root.getBoundingClientRect().right + 1;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !shown(parent) || (skip && parent.closest(skip))) continue;
    const text = node.textContent ?? "";
    const lines: { start: number; end: number; box: DOMRect }[] = [];
    for (const word of text.matchAll(/\S+/g)) {
      range.setStart(node, word.index);
      range.setEnd(node, word.index + word[0].length);
      const box = range.getBoundingClientRect();
      // What an ellipsis cuts off stays out.
      if (!box.width || box.right > edge) break;
      const line = lines.at(-1);
      if (line && Math.abs(box.top - line.box.top) < box.height / 2) {
        line.end = word.index + word[0].length;
        line.box = new DOMRect(line.box.x, line.box.y, box.right - line.box.x, line.box.height);
      } else lines.push({ start: word.index, end: word.index + word[0].length, box });
    }
    const style = getComputedStyle(parent);
    for (const { start, end, box } of lines) {
      const said = text.slice(start, end).replace(/\s+/g, " ");
      const drop = baseline(style, said, box.height);
      const look = [
        `fill="${style.color}"`,
        `font-family="${escape(style.fontFamily)}"`,
        `font-size="${style.fontSize}"`,
        `font-weight="${style.fontWeight}"`,
        style.fontStyle === "normal" ? "" : `font-style="${style.fontStyle}"`,
        style.letterSpacing === "normal" ? "" : `letter-spacing="${style.letterSpacing}"`,
        style.fontVariantNumeric === "normal"
          ? ""
          : `style="font-variant-numeric:${style.fontVariantNumeric}"`,
      ].join(" ");
      parts.push({
        box,
        draw: (x, y) =>
          `<text x="${round(x)}" y="${round(y + drop)}" ${look}>${escape(said)}</text>`,
      });
    }
  }
  return parts;
}

/** A series' dot in the key. */
function swatchPart(swatch: Element): Part {
  const box = swatch.getBoundingClientRect();
  const style = getComputedStyle(swatch);
  const radius = Math.min(
    parseFloat(style.borderTopLeftRadius) || 0,
    box.width / 2,
    box.height / 2,
  );
  return {
    box,
    draw: (x, y) =>
      `<rect x="${round(x)}" y="${round(y)}" width="${round(box.width)}" height="${round(box.height)}" rx="${round(radius)}" fill="${style.backgroundColor}"/>`,
  };
}

/** The plot, all it draws: its labels may sit past its box. */
function plotPart(plot: SVGSVGElement): Part {
  const drawn = standaloneSvg(plot);
  const at = plot.getBoundingClientRect();
  const box = new DOMRect(at.x + drawn.x, at.y + drawn.y, drawn.width, drawn.height);
  return {
    box,
    draw: (x, y) => drawn.text.replace("<svg", `<svg x="${round(x)}" y="${round(y)}"`),
  };
}

/**
 * The chart as a picture to paste elsewhere: its heading, its key with the
 * values it shows, the plot, and where the data came from, each where the page
 * lays it out.
 */
export function chartPicture(frame: HTMLElement) {
  const plot = frame.querySelector<SVGSVGElement>("svg[data-chart-plot]");
  if (!plot) throw new Error("The chart has not drawn yet.");
  const parts: Part[] = [];
  for (const element of frame.querySelectorAll(
    "[data-chart-title], [data-chart-subtitle], [data-chart-big], [data-chart-moment]",
  ))
    parts.push(...textParts(element));
  for (const key of frame.querySelectorAll("[data-chart-key]:not([data-hidden])")) {
    const swatch = key.querySelector("[data-key-swatch]");
    if (swatch) parts.push(swatchPart(swatch));
    parts.push(...textParts(key));
  }
  parts.push(plotPart(plot));
  const source = frame.querySelector("[data-chart-source]");
  if (source) parts.push(...textParts(source, "[data-chart-status]"));

  const left = Math.min(...parts.map(({ box }) => box.left)) - COPY_PAD;
  const top = Math.min(...parts.map(({ box }) => box.top)) - COPY_PAD;
  const width = Math.ceil(Math.max(...parts.map(({ box }) => box.right)) + COPY_PAD - left);
  const height = Math.ceil(Math.max(...parts.map(({ box }) => box.bottom)) + COPY_PAD - top);
  const body = parts.map(({ box, draw }) => draw(box.left - left, box.top - top)).join("");
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
    width,
    height,
  };
}

/** The chart's picture as a PNG, on the chart's surface at twice its size. */
export async function copyChart(frame: HTMLElement) {
  const { svg, width, height } = chartPicture(frame);
  const png = svgPng(svg, width, height, backdropOf(frame));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
