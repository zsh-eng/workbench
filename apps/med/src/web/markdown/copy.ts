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
  return lines
    .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line.trimStart()))
    .join("\n");
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

/** An SVG blob drawn to an image first: createImageBitmap does not take SVG everywhere. */
async function svgPng(svg: string, width: number, height: number, background: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d")!;
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
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

/**
 * A diagram's SVG with its colors and fonts written in, so it draws the same
 * outside the page: Pele colors it with the theme's CSS variables.
 */
export function standaloneSvg(svg: SVGSVGElement) {
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
  const width = Number(svg.getAttribute("width")) || svg.getBoundingClientRect().width;
  const height = Number(svg.getAttribute("height")) || svg.getBoundingClientRect().height;
  copy.setAttribute("viewBox", `0 0 ${width} ${height}`);
  copy.removeAttribute("tabindex");
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(width));
  copy.setAttribute("height", String(height));
  return { text: new XMLSerializer().serializeToString(copy), width, height };
}

/** The diagram's surface, so a pasted PNG reads as it does on the page. */
function surfaceOf(svg: SVGSVGElement) {
  const host = svg.closest<HTMLElement>(".med-md-diagram") ?? svg.parentElement!;
  return getComputedStyle(host).getPropertyValue("--pele-bg").trim() || "#ffffff";
}

export async function copyDiagram(svg: SVGSVGElement) {
  const { text, width, height } = standaloneSvg(svg);
  const background = resolveColor(surfaceOf(svg), svg);
  const png = svgPng(text, width, height, background);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

export async function copyDiagramSvg(svg: SVGSVGElement) {
  await navigator.clipboard.writeText(standaloneSvg(svg).text);
}

/** A CSS color, such as a `color-mix()` or a variable, as the canvas can paint it. */
function resolveColor(color: string, near: Element) {
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
