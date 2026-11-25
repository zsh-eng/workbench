import type { Mounted } from "pele/lazy";

// Mermaid diagrams, drawn by Pele (github.com/obsidianmd/pele). It reads
// Mermaid's syntax, draws in well under a millisecond, and takes its colors
// from CSS variables, so a theme change restyles a diagram without drawing it
// again; MarkdownPreview.css maps them to Med's tokens. Each diagram type
// loads on demand.

const OPTIONS = {
  // Med's code-block size, in place of Pele's 16 px.
  fontSize: 13,
  padding: 4,
  limit: 20_000,
  // A link would take the window away from Med, and an image would load from
  // the network: diagrams in a brief come from an agent.
  links: false,
  images: false,
};

/**
 * How the reader has turned a diagram: drawn as its source says, or the other
 * way, top to bottom for left to right. Until they choose, Pele chooses: a
 * left-to-right diagram that a narrow pane cannot fit runs downward.
 */
export type Turn = "as-written" | "turned";

interface DrawOptions {
  /** Keeps Pele's zoom on, up to `maxScale`, also for a diagram that fits. */
  zoom?: { maxScale: number };
  turn?: Turn;
}

/** The source that a turn draws, and Pele's options for it. */
function drawing(source: string, { zoom, turn }: DrawOptions) {
  return {
    text: (turn === "turned" && turnDiagram(source)) || source,
    options: {
      ...OPTIONS,
      ...(zoom ? { zoom: { always: true, maxScale: zoom.maxScale } } : {}),
      // A diagram the reader turned stays as they left it at any width.
      ...(turn ? { autoDirection: false } : {}),
    },
  };
}

let peleModule: Promise<typeof import("pele/lazy")> | undefined;
let peleResolved: typeof import("pele/lazy") | undefined;
function loadPele() {
  return (peleModule ??= import("pele/lazy")
    .then((mod) => {
      peleResolved = mod;
      return mod;
    })
    .catch((error) => {
      peleModule = undefined;
      throw error;
    }));
}

const MERMAID_FENCE = /(?:```|~~~)\s*mermaid[^\n]*\n([\s\S]*?)(?:\n[ \t]*(?:```|~~~)|$)/gi;

/** Preloads Pele's lazy module — and any diagram types found in `markdown` —
 * so diagrams mount synchronously before first paint without a loading jump. */
export function preloadDiagrams(markdown?: string) {
  void loadPele()
    .then((pele) => {
      if (!markdown) return;
      MERMAID_FENCE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = MERMAID_FENCE.exec(markdown))) {
        const source = match[1]?.trim();
        if (!source) continue;
        try {
          const type = pele.detectType(source);
          if (type && !pele.registered(type)) void pele.load(type).catch(() => {});
        } catch {
          /* Invalid syntax will be surfaced when the block mounts. */
        }
      }
    })
    .catch(() => {});
}

const SKIP_COLOR = /^(?:none|transparent|currentcolor|inherit|initial|unset|var\(|url\()/i;

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

let colorContext: CanvasRenderingContext2D | null | undefined;
function parseCssColor(raw: string): Rgba | undefined {
  const value = raw.trim();
  if (!value || SKIP_COLOR.test(value)) return undefined;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (hex) {
    const digits = hex[1]!;
    if (digits.length === 3 || digits.length === 4) {
      const r = parseInt(digits[0]! + digits[0]!, 16);
      const g = parseInt(digits[1]! + digits[1]!, 16);
      const b = parseInt(digits[2]! + digits[2]!, 16);
      const a = digits.length === 4 ? parseInt(digits[3]! + digits[3]!, 16) / 255 : 1;
      return { r, g, b, a };
    }
    const r = parseInt(digits.slice(0, 2), 16);
    const g = parseInt(digits.slice(2, 4), 16);
    const b = parseInt(digits.slice(4, 6), 16);
    const a = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  const rgb =
    /^rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(
      value,
    );
  if (rgb) {
    const channel = (s: string) =>
      Math.max(
        0,
        Math.min(255, Math.round(s.endsWith("%") ? (parseFloat(s) / 100) * 255 : parseFloat(s))),
      );
    const alphaRaw = rgb[4];
    const a =
      alphaRaw === undefined
        ? 1
        : alphaRaw.endsWith("%")
          ? Math.max(0, Math.min(1, parseFloat(alphaRaw) / 100))
          : Math.max(0, Math.min(1, parseFloat(alphaRaw)));
    return {
      r: channel(rgb[1]!),
      g: channel(rgb[2]!),
      b: channel(rgb[3]!),
      a,
    };
  }
  // Named colors or hsl(...) via offscreen 2D canvas fillStyle normalization.
  if (typeof document === "undefined") return undefined;
  if (colorContext === undefined) colorContext = document.createElement("canvas").getContext("2d");
  if (!colorContext) return undefined;
  colorContext.fillStyle = "#010203";
  const sentinel = colorContext.fillStyle;
  colorContext.fillStyle = value;
  const normalized = colorContext.fillStyle;
  if (normalized === sentinel && value.toLowerCase() !== "#010203") return undefined;
  return normalized !== value ? parseCssColor(normalized) : undefined;
}

function rgbToHsl({ r, g, b }: Rgba): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function formatHsl(h: number, s: number, l: number, a: number) {
  const hd = Math.round(((h % 360) + 360) % 360);
  const sp = Math.round(Math.max(0, Math.min(1, s)) * 100);
  const lp = Math.round(Math.max(0, Math.min(1, l)) * 100);
  return a < 0.999
    ? `hsla(${hd}, ${sp}%, ${lp}%, ${Number(a.toFixed(3))})`
    : `hsl(${hd}, ${sp}%, ${lp}%)`;
}

const SHAPE_TAGS = new Set(["rect", "polygon", "circle", "ellipse", "path"]);
const TEXT_TAGS = new Set(["text", "tspan"]);

function isDarkAppearance(element: HTMLElement): boolean {
  const root = element.ownerDocument?.documentElement;
  if (root?.dataset.appearance) return root.dataset.appearance === "dark";
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Adapts author-specified literal Mermaid colors (`style`, `classDef`, sequence
 * `rect rgb(...)`) for dark themes so pastel fills do not become unreadable
 * white-on-pastel blocks and dark strokes/text remain legible. Original values
 * are kept on `data-med-orig-*` so switching back to light mode restores them.
 */
export function themeDiagramSvg(element: HTMLElement) {
  const svg = element.querySelector("svg");
  if (!svg) return;
  const dark = isDarkAppearance(element);
  for (const node of svg.querySelectorAll<SVGElement>("[style], [fill], [stroke]")) {
    const tag = node.tagName.toLowerCase();
    const isShape = SHAPE_TAGS.has(tag);
    const isText = TEXT_TAGS.has(tag);

    // Snapshot original inline style/attribute values once per rendered SVG.
    if (node.dataset.medOrigFill === undefined) {
      const inlineFill = node.style.fill;
      const attrFill = node.getAttribute("fill");
      if (inlineFill && !SKIP_COLOR.test(inlineFill)) node.dataset.medOrigFill = `s:${inlineFill}`;
      else if (attrFill && !SKIP_COLOR.test(attrFill)) node.dataset.medOrigFill = `a:${attrFill}`;
    }
    if (node.dataset.medOrigStroke === undefined) {
      const inlineStroke = node.style.stroke;
      const attrStroke = node.getAttribute("stroke");
      if (inlineStroke && !SKIP_COLOR.test(inlineStroke))
        node.dataset.medOrigStroke = `s:${inlineStroke}`;
      else if (attrStroke && !SKIP_COLOR.test(attrStroke))
        node.dataset.medOrigStroke = `a:${attrStroke}`;
    }
    if (node.dataset.medOrigColor === undefined) {
      const inlineColor = node.style.color;
      if (inlineColor && !SKIP_COLOR.test(inlineColor)) node.dataset.medOrigColor = inlineColor;
    }

    const origFill = node.dataset.medOrigFill;
    if (origFill) {
      const raw = origFill.slice(2);
      const next = dark ? adaptFill(raw, isShape, isText) : raw;
      if (origFill.startsWith("s:")) node.style.fill = next;
      else node.setAttribute("fill", next);
    }

    const origStroke = node.dataset.medOrigStroke;
    if (origStroke) {
      const raw = origStroke.slice(2);
      const next = dark ? adaptStroke(raw) : raw;
      if (origStroke.startsWith("s:")) node.style.stroke = next;
      else node.setAttribute("stroke", next);
    }

    const origColor = node.dataset.medOrigColor;
    if (origColor) {
      node.style.color = dark ? adaptText(origColor) : origColor;
    }
  }
}

function adaptFill(raw: string, isShape: boolean, isText: boolean): string {
  const rgba = parseCssColor(raw);
  if (!rgba) return raw;
  const [h, s, l] = rgbToHsl(rgba);
  if (isText)
    return l < 0.55 ? formatHsl(h, Math.min(s, 0.4), Math.max(0.82, 1 - l * 0.45), rgba.a) : raw;
  if (!isShape) return raw;
  // Light/pastel fills written for white pages become deep tinted dark surfaces
  // that preserve color-coding while keeping light `--pele-fg` labels crisp.
  if (l > 0.48) {
    const nextL = 0.17 + (1 - l) * 0.22;
    const nextS = s < 0.08 ? s : Math.min(0.6, Math.max(0.28, s * 0.72));
    return formatHsl(h, nextS, nextL, rgba.a);
  }
  return raw;
}

function adaptStroke(raw: string): string {
  const rgba = parseCssColor(raw);
  if (!rgba) return raw;
  const [h, s, l] = rgbToHsl(rgba);
  // Dark strokes disappear on dark diagram backdrops; lift while keeping hue.
  if (l < 0.48) {
    const nextL = 0.56 + (0.48 - l) * 0.28;
    const nextS = s < 0.08 ? s : Math.min(0.78, Math.max(0.45, s));
    return formatHsl(h, nextS, nextL, rgba.a);
  }
  return raw;
}

function adaptText(raw: string): string {
  const rgba = parseCssColor(raw);
  if (!rgba) return raw;
  const [h, s, l] = rgbToHsl(rgba);
  if (l < 0.55) return formatHsl(h, Math.min(s, 0.4), Math.max(0.82, 1 - l * 0.45), rgba.a);
  return raw;
}

const mountedElements = new WeakMap<Mounted, HTMLElement>();

function wrapMounted(mounted: Mounted, element: HTMLElement, onRender: () => void): Mounted {
  if (mounted.error !== undefined) {
    mounted.destroy();
    element.replaceChildren();
    throw mounted.error;
  }
  themeDiagramSvg(element);
  const origRefresh = mounted.refresh.bind(mounted);
  const origUpdate = mounted.update.bind(mounted);
  const wrapped: Mounted = {
    get source() {
      return mounted.source;
    },
    get result() {
      return mounted.result;
    },
    get error() {
      return mounted.error;
    },
    get zoom() {
      return mounted.zoom;
    },
    update(nextSource, nextOptions) {
      origUpdate(nextSource, nextOptions ? { ...nextOptions, onRender } : { onRender });
      themeDiagramSvg(element);
    },
    refresh() {
      origRefresh();
      themeDiagramSvg(element);
    },
    destroy() {
      mounted.destroy();
    },
  };
  mountedElements.set(wrapped, element);
  return wrapped;
}

/**
 * Draws a diagram synchronously when Pele and the diagram's renderer are
 * already loaded in memory; returns `null` when an async chunk load is still
 * needed. Throws synchronously when the source cannot draw.
 */
export function mountDiagramSync(
  element: HTMLElement,
  source: string,
  draw: DrawOptions = {},
): Mounted | null {
  const pele = peleResolved;
  if (!pele) return null;
  const { text, options } = drawing(source, draw);
  let type: ReturnType<typeof pele.detectType> = null;
  try {
    type = pele.detectType(text);
  } catch {
    /* Let mount() report the syntax error below. */
  }
  if (type !== null && !pele.registered(type)) return null;
  const onRender = () => themeDiagramSvg(element);
  const mounted = pele.mount(element, text, { ...options, onRender });
  return wrapMounted(mounted, element, onRender);
}

/**
 * Draws a diagram in `element`. Pele keeps it fitted to the element's width
 * (a narrow pane can turn a left-to-right flowchart downward) and offers zoom
 * when a diagram has to shrink. Rejects when the source does not draw, so the
 * caller shows it as code; Pele's own error text stays out of the page.
 */
export async function mountDiagram(
  element: HTMLElement,
  source: string,
  draw: DrawOptions = {},
): Promise<Mounted> {
  const { mountAsync } = await loadPele();
  const { text, options } = drawing(source, draw);
  const onRender = () => themeDiagramSvg(element);
  const mounted = await mountAsync(element, text, { ...options, onRender });
  return wrapMounted(mounted, element, onRender);
}

/** Draws a mounted diagram again, for an edit to its source or a turn. */
export function redrawDiagram(mounted: Mounted, source: string, draw: DrawOptions = {}) {
  const { text, options } = drawing(source, draw);
  mounted.update(text, options);
  const el = mountedElements.get(mounted);
  if (el) themeDiagramSvg(el);
}

/**
 * Turns a drawn diagram the other way from how it shows, and returns the turn
 * that keeps it so. Before the reader's first turn Pele may have turned it
 * already, to fit the pane: drawn as written, it then changes, and that is
 * the other way.
 */
export function turnDrawn(mounted: Mounted, source: string, draw: DrawOptions): Turn {
  if (draw.turn) {
    const next = draw.turn === "turned" ? "as-written" : "turned";
    redrawDiagram(mounted, source, { ...draw, turn: next });
    return next;
  }
  const shown = mounted.result?.svg;
  redrawDiagram(mounted, source, { ...draw, turn: "as-written" });
  if (mounted.result?.svg !== shown) return "as-written";
  redrawDiagram(mounted, source, { ...draw, turn: "turned" });
  return "turned";
}

/** Each direction, turned a quarter: down becomes right, up becomes left. */
const ACROSS: Record<string, string> = { TB: "LR", TD: "LR", BT: "RL", LR: "TB", RL: "BT" };
const DIRECTION = /^(\s*direction\s+)(TB|TD|BT|RL|LR)\b/;

/**
 * The source with its layout turned a quarter: a top-to-bottom diagram runs
 * left to right, and the other way, in each `direction` it gives (a subgraph's
 * too). Undefined for a diagram that has no direction, such as a sequence or a
 * pie. Flowcharts, state, class, entity and requirement diagrams, and Git
 * graphs turn; each runs top to bottom unless its source says otherwise, but
 * a Git graph, which runs left to right.
 */
export function turnDiagram(source: string): string | undefined {
  const lines = source.split("\n");
  const at = headerLine(lines);
  const header = lines[at];
  if (header === undefined) return undefined;
  const turnAll = () =>
    lines.map((line, index) =>
      index > at ? line.replace(DIRECTION, (_, lead, way) => lead + ACROSS[way]) : line,
    );

  const flow = header.match(
    /^(\s*(?:flowchart-elk|flowchart|graph))(?:([ \t]+)(TB|TD|BT|RL|LR))?(?=[\s;]|$)/,
  );
  if (flow) {
    const turned = turnAll();
    turned[at] =
      flow[1] + (flow[2] ?? " ") + ACROSS[flow[3] ?? "TB"] + header.slice(flow[0].length);
    return turned.join("\n");
  }
  const git = header.match(/^(\s*gitGraph)(?:[ \t]+(LR|TB|BT))?[ \t]*:?/);
  if (git) {
    lines[at] =
      `${git[1]} ${git[2] === "TB" || git[2] === "BT" ? "LR" : "TB"}:${header.slice(git[0].length)}`;
    return lines.join("\n");
  }
  if (
    !/^\s*(?:stateDiagram(?:-v2)?|classDiagram(?:-v2)?|erDiagram|requirementDiagram)\b/.test(header)
  )
    return undefined;
  const turned = turnAll();
  // A diagram that names no direction of its own runs top to bottom.
  if (!ownDirection(lines, at)) {
    const next = lines.slice(at + 1).find((line) => line.trim());
    const indent = next?.match(/^\s*/)?.[0] || "  ";
    turned.splice(at + 1, 0, `${indent}direction LR`);
  }
  return turned.join("\n");
}

/** The line that names the diagram, after its front matter and comments. */
function headerLine(lines: readonly string[]) {
  let at = 0;
  while (at < lines.length && !lines[at]!.trim()) at++;
  if (lines[at]?.trim() === "---") {
    at++;
    while (at < lines.length && lines[at]!.trim() !== "---") at++;
    at++;
  }
  while (at < lines.length && (!lines[at]!.trim() || lines[at]!.trim().startsWith("%%"))) at++;
  return at;
}

/** Whether the diagram gives its own direction, outside any `{ }` block. */
function ownDirection(lines: readonly string[], header: number) {
  let depth = 0;
  for (const line of lines.slice(header + 1)) {
    if (depth === 0 && DIRECTION.test(line)) return true;
    const code = line.replace(/"[^"]*"/g, "");
    depth = Math.max(
      0,
      depth + (code.match(/\{/g)?.length ?? 0) - (code.match(/\}/g)?.length ?? 0),
    );
  }
  return false;
}
