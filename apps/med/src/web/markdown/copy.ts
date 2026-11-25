/**
 * Copying from the Markdown preview: a table as its Markdown and as a table
 * that rich editors paste, an image as a PNG, a diagram as a PNG or an SVG
 * that draws without the page's styles.
 */

/** Lines `start` to `end` (1-based, inclusive) of a document. */
export function sourceLines(text: string, start: number, end: number) {
  return text.split("\n").slice(start - 1, end);
}

/**
 * A table's Markdown, from its lines in the document. A table in a quote or a
 * list keeps the prefix that each of its lines shares, so it is dropped.
 */
export function tableMarkdown(text: string, table: HTMLElement) {
  const start = Number(table.dataset.sourceLine);
  const end = Number(table.dataset.sourceEnd);
  if (!start || !end) return tableText(table);
  const lines = sourceLines(text, start, end);
  const prefix = lines[0]?.match(/^[\s>]*/)?.[0] ?? "";
  const markdown = lines.map((line) =>
    line.startsWith(prefix) ? line.slice(prefix.length) : line.trimStart(),
  );
  // Lines that are not a table's, as from a text that changed since it
  // rendered, copy as cells.
  if (!markdown[0]?.includes("|") || !/^\s*\|?\s*:?-+/.test(markdown[1] ?? ""))
    return tableText(table);
  return markdown.join("\n");
}

/** Tab-separated cells, for a table without its source. */
function tableText(table: HTMLElement) {
  return [...table.querySelectorAll("tr")]
    .map((row) =>
      [...row.querySelectorAll("th, td")]
        .map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim())
        .join("\t"),
    )
    .join("\n");
}

/** The table as rich editors and spreadsheets paste it: cells and inline marks, no page classes. */
export function tableHtml(table: HTMLElement) {
  const copy = table.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("wbr").forEach((node) => node.remove());
  for (const node of [copy, ...copy.querySelectorAll<HTMLElement>("*")])
    for (const name of node.getAttributeNames())
      if (name.startsWith("data-") || name === "class" || name === "style")
        node.removeAttribute(name);
  return copy.outerHTML;
}

export async function copyTable(text: string, table: HTMLElement) {
  const markdown = tableMarkdown(text, table);
  const html = tableHtml(table);
  if (typeof ClipboardItem === "undefined") return navigator.clipboard.writeText(markdown);
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/plain": new Blob([markdown], { type: "text/plain" }),
      "text/html": new Blob([html], { type: "text/html" }),
    }),
  ]);
}

/** A PNG of an image blob: the clipboard takes PNG images everywhere. */
async function pngOf(blob: Blob) {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (png) => (png ? resolve(png) : reject(new Error("The image could not be drawn."))),
      "image/png",
    ),
  );
}

/** A blob as a data URL. */
function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsDataURL(blob);
  });
}

const fontFiles = new Map<string, Promise<string>>();

/** A font file as a data URL, fetched once. */
function fontFile(url: string) {
  let file = fontFiles.get(url);
  if (!file) {
    file = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`The font did not load (${response.status}).`);
      return dataUrl(await response.blob());
    });
    file.catch(() => fontFiles.delete(url));
    fontFiles.set(url, file);
  }
  return file;
}

function* fontRules(rules: CSSRuleList): Generator<CSSFontFaceRule> {
  for (const rule of rules) {
    if (rule instanceof CSSFontFaceRule) yield rule;
    else if ("cssRules" in rule) yield* fontRules(rule.cssRules as CSSRuleList);
  }
}

/**
 * The page's `@font-face` rules for the families a drawing names, with their
 * files written in. An SVG drawn as an image loads nothing, and a fallback
 * font's other widths would run labels out of the boxes sized for the page's.
 */
export async function fontFaces(svg: string) {
  const faces: Promise<string>[] = [];
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // Another site's sheet.
    }
    for (const rule of fontRules(rules)) {
      const family = rule.style.getPropertyValue("font-family").replace(/^["']|["']$/g, "");
      const src = rule.style.getPropertyValue("src").match(/url\(\s*["']?([^"')]+)/)?.[1];
      if (!family || !src || src.startsWith("data:") || !svg.includes(family)) continue;
      const url = new URL(src, sheet.href ?? location.href).href;
      faces.push(
        fontFile(url).then(
          (file) => rule.cssText.replace(src, file),
          // Without the file, the drawing keeps the fallback.
          () => "",
        ),
      );
    }
  }
  return (await Promise.all(faces)).join("");
}

/**
 * An SVG drawn to a PNG at twice its size, on its backdrop's colors, in the
 * page's fonts. It is drawn as an image first: createImageBitmap does not take
 * SVG everywhere.
 */
export async function svgPng(svg: string, width: number, height: number, backdrop: string[]) {
  const faces = await fontFaces(svg);
  const text = faces
    ? svg.replace(/<svg\b[^>]*>/, (open) => `${open}<style>${faces}</style>`)
    : svg;
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d")!;
    for (const color of backdrop) {
      context.fillStyle = color;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (png) => (png ? resolve(png) : reject(new Error("The diagram could not be drawn."))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Copy an image as a PNG. The blob is a promise inside the clipboard item, so
 * the write starts within the click, as Safari needs. An image from another
 * site that does not allow reading copies as its address instead.
 */
export async function copyImage(image: HTMLImageElement) {
  const url = image.currentSrc || image.src;
  const png = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`The image did not load (${response.status}).`);
      return response.blob();
    })
    .then((blob) => pngOf(blob));
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  } catch (error) {
    if (new URL(url, location.href).origin === location.origin) throw error;
    await navigator.clipboard.writeText(url);
    return "address" as const;
  }
  return "image" as const;
}

/** SVG properties that Pele sets through the page's styles. */
const PAINT = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "visibility",
] as const;

/** Room around a copied picture, so it does not end at its outermost line. */
export const COPY_PAD = 24;

/** What a drawing covers, overflow included: Pele and the charts draw past their box. */
function contentBox(svg: SVGSVGElement, width: number, height: number) {
  let box = { x: 0, y: 0, width, height };
  try {
    box = svg.getBBox();
  } catch {
    // Not laid out: its own box.
  }
  const left = Math.min(0, box.x);
  const top = Math.min(0, box.y);
  return {
    x: left,
    y: top,
    width: Math.max(width, box.x + box.width) - left,
    height: Math.max(height, box.y + box.height) - top,
  };
}

/**
 * A diagram's SVG with its colors and fonts written in, so it draws the same
 * outside the page: Pele colors it with the theme's CSS variables. It covers
 * all it draws, with `pad` around; `x` and `y` are where its view box starts.
 */
export function standaloneSvg(svg: SVGSVGElement, pad = 0) {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll("*")];
  const to = [copy, ...copy.querySelectorAll("*")];
  from.forEach((node, index) => {
    const target = to[index] as SVGElement;
    const style = getComputedStyle(node);
    target.removeAttribute("class");
    // The style below sets these; a variable means nothing outside the page.
    for (const name of target.getAttributeNames())
      if (target.getAttribute(name)?.includes("var(")) target.removeAttribute(name);
    target.setAttribute(
      "style",
      PAINT.map((name) => `${name}:${style.getPropertyValue(name)}`).join(";"),
    );
  });
  // Pele draws at its width and height, and zooms by the view box.
  const drawnWidth = Number(svg.getAttribute("width")) || svg.getBoundingClientRect().width;
  const drawnHeight = Number(svg.getAttribute("height")) || svg.getBoundingClientRect().height;
  const box = contentBox(svg, drawnWidth, drawnHeight);
  const x = box.x - pad;
  const y = box.y - pad;
  const width = Math.ceil(box.width + 2 * pad);
  const height = Math.ceil(box.height + 2 * pad);
  copy.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  copy.removeAttribute("tabindex");
  for (const node of copy.querySelectorAll(
    "[data-med-orig-fill], [data-med-orig-stroke], [data-med-orig-color]",
  )) {
    node.removeAttribute("data-med-orig-fill");
    node.removeAttribute("data-med-orig-stroke");
    node.removeAttribute("data-med-orig-color");
  }
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(width));
  copy.setAttribute("height", String(height));
  return { text: new XMLSerializer().serializeToString(copy), width, height, x, y };
}

let probe: CanvasRenderingContext2D | undefined;

/** A color's opacity, as the canvas reads it. */
function alphaOf(color: string) {
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "transparent";
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  return probe.getImageData(0, 0, 1, 1).data[3]! / 255;
}

/**
 * The colors that show behind an element, to fill in order: its own surface
 * on the first opaque one under it. A see-through surface alone would paste
 * as light text on whatever the other app shows.
 */
export function backdropOf(element: Element, surface?: string) {
  const layers = [resolveColor(surface ?? getComputedStyle(element).backgroundColor, element)];
  for (
    let node = element.parentElement;
    node && alphaOf(layers[0]!) < 1;
    node = node.parentElement
  ) {
    const color = getComputedStyle(node).backgroundColor;
    if (alphaOf(color) > 0) layers.unshift(color);
  }
  if (alphaOf(layers[0]!) < 1) layers.unshift("#ffffff");
  return layers;
}

/** The diagram's surface, so a pasted PNG reads as it does on the page. */
function surfaceOf(svg: SVGSVGElement) {
  const host = svg.closest<HTMLElement>(".med-md-diagram") ?? svg.parentElement!;
  const surface = getComputedStyle(host).getPropertyValue("--pele-bg").trim();
  return backdropOf(host, surface || undefined);
}

export async function copyDiagram(svg: SVGSVGElement) {
  const { text, width, height } = standaloneSvg(svg, COPY_PAD);
  const png = svgPng(text, width, height, surfaceOf(svg));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

export async function copyDiagramSvg(svg: SVGSVGElement) {
  await navigator.clipboard.writeText(standaloneSvg(svg).text);
}

/** A CSS color, such as a `color-mix()` or a variable, as the canvas can paint it. */
export function resolveColor(color: string, near: Element) {
  const probe = document.createElement("span");
  probe.style.color = color;
  probe.style.display = "none";
  (near.parentElement ?? document.body).append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || "#ffffff";
}

/**
 * The Mermaid source of a diagram block: its lines in the document, less the
 * fences. A list or a quote's prefix stays out, as for tables.
 */
export function diagramSource(text: string, start: number, end: number) {
  const lines = sourceLines(text, start, end);
  const prefix = lines[0]?.match(/^[\s>]*/)?.[0] ?? "";
  const body = lines.map((line) =>
    line.startsWith(prefix) ? line.slice(prefix.length) : line.trimStart(),
  );
  if (/^(`{3,}|~{3,})/.test(body[0] ?? "")) body.shift();
  if (/^(`{3,}|~{3,})\s*$/.test(body.at(-1) ?? "")) body.pop();
  return body.join("\n");
}
