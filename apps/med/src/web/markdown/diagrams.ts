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
  const { mountAsync } = await import("pele/lazy");
  const { text, options } = drawing(source, draw);
  const mounted = await mountAsync(element, text, options);
  if (mounted.error !== undefined) {
    mounted.destroy();
    element.replaceChildren();
    throw mounted.error;
  }
  return mounted;
}

/** Draws a mounted diagram again, for an edit to its source or a turn. */
export function redrawDiagram(mounted: Mounted, source: string, draw: DrawOptions = {}) {
  const { text, options } = drawing(source, draw);
  mounted.update(text, options);
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
