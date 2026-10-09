let serial = Promise.resolve();
let sequence = 0;
const cache = new Map<string, string>();

/** `from` moved toward `to` by `amount`, for hex colors. */
function mix(from: string, to: string, amount: number) {
  const channel = (hex: string, index: number) =>
    parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  return `#${[0, 1, 2]
    .map((index) =>
      Math.round(channel(from, index) + (channel(to, index) - channel(from, index)) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Mermaid's base theme in the current Med theme's colors, so diagrams match
 * the page instead of Mermaid's own dark or neutral palette. A diagram sits
 * on the code-block surface; nodes are raised cards on it. */
function themeVariables(dark: boolean) {
  const root = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => {
    const value = root.getPropertyValue(`--med-${name}`).trim();
    return /^#[\da-f]{6}$/i.test(value) ? value : fallback;
  };
  const text = color("text", dark ? "#ececef" : "#18181b");
  const raised = color("raised", dark ? "#1b1b1e" : "#ffffff");
  const border = color("border", dark ? "#28282d" : "#e1e1e5");
  const muted = color("muted", dark ? "#9d9da6" : "#5f5f68");
  const accent = color("accent", dark ? "#8f9cff" : "#4f5bd5");
  const ground = color("panel", dark ? "#0d0d0f" : "#f7f7f8");
  const edge = mix(ground, text, dark ? 0.42 : 0.36);
  const outline = mix(ground, text, dark ? 0.2 : 0.16);
  return {
    darkMode: dark,
    fontFamily: "Geist, sans-serif",
    fontSize: "13px",
    background: ground,
    mainBkg: raised,
    primaryColor: raised,
    primaryTextColor: text,
    primaryBorderColor: outline,
    nodeBorder: outline,
    secondaryColor: raised,
    tertiaryColor: ground,
    lineColor: edge,
    textColor: text,
    titleColor: muted,
    edgeLabelBackground: ground,
    clusterBkg: mix(ground, text, dark ? 0.035 : 0.025),
    clusterBorder: border,
    noteBkgColor: mix(ground, accent, dark ? 0.16 : 0.1),
    noteTextColor: text,
    noteBorderColor: mix(ground, accent, dark ? 0.42 : 0.34),
    actorBkg: raised,
    actorBorder: outline,
    actorTextColor: text,
    actorLineColor: border,
    signalColor: edge,
    signalTextColor: text,
    activationBkgColor: mix(ground, accent, dark ? 0.2 : 0.14),
    activationBorderColor: mix(ground, accent, 0.45),
    sequenceNumberColor: ground,
    labelBoxBkgColor: raised,
    labelBoxBorderColor: outline,
    labelTextColor: text,
    loopTextColor: muted,
  };
}

// Mermaid scopes this to each diagram. Rounded cards, thin lines, and quiet
// labels, so a diagram reads like the rest of Med.
const themeCSS = `
  .node rect, .node polygon, .node path, .node circle { stroke-width: 1px; }
  .node rect, .cluster rect, rect.actor, rect.note, rect.labelBox, .statediagram-state rect,
  .classGroup rect, .er.entityBox, rect.basic { rx: 6px; ry: 6px; }
  .flowchart-link, .edgePath .path, .transition, .relation { stroke-width: 1.25px; }
  .edgeLabel, .edgeLabel p, .edgeLabel span { font-size: 12px; }
  .cluster-label, .cluster-label span, .cluster-label p { font-size: 12px; font-weight: 500; }
  .actor-line { stroke-dasharray: 3 4; }
  .messageLine0, .messageLine1 { stroke-width: 1.25px; }
`;

/** Mermaid uses shared configuration. Serialize renders and retain unchanged diagrams. */
export function renderDiagram(source: string, dark: boolean) {
  const variables = themeVariables(dark);
  const key = `${JSON.stringify(variables)}:${source}`;
  const known = cache.get(key);
  if (known) return Promise.resolve(known);
  const result = serial.then(async () => {
    if (cache.has(key)) return cache.get(key)!;
    if (source.length > 20_000) throw new Error("Diagram exceeds the 20,000 character limit.");
    const [{ default: mermaid }] = await Promise.all([
      import("mermaid"),
      // Mermaid measures labels when it lays out; measure them in Geist.
      document.fonts.load('13px "Geist"').catch(() => []),
    ]);
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeCSS,
      // Mermaid 12's default "neo" look adds grey drop shadows that do not
      // follow the theme; the classic look draws flat shapes.
      look: "classic",
      themeVariables: variables,
      fontFamily: "Geist, sans-serif",
      // Sequence diagrams take this over their own font sizes.
      fontSize: 13,
      flowchart: { padding: 8, nodeSpacing: 28, rankSpacing: 32, diagramPadding: 4 },
      sequence: {
        actorFontSize: 13,
        messageFontSize: 13,
        noteFontSize: 12,
        width: 120,
        height: 38,
        boxMargin: 8,
        mirrorActors: false,
      },
      maxTextSize: 20_000,
      maxEdges: 500,
      suppressErrorRendering: true,
    });
    const container = document.createElement("div");
    container.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;visibility:hidden";
    document.body.append(container);
    try {
      const rendered = await mermaid.render(`med-diagram-${++sequence}`, source, container);
      // A wide diagram shrinks to fit only so far; past that its text gets too
      // small to read, so it keeps 72% of its size and scrolls sideways.
      const svg = rendered.svg.replace(
        /^(<svg[^>]*?style=")max-width: ([\d.]+)px;/,
        (_, start: string, width: string) =>
          `${start}max-width: ${width}px; min-width: ${Math.round(Number(width) * 0.72)}px;`,
      );
      if (cache.size >= 16) cache.delete(cache.keys().next().value!);
      cache.set(key, svg);
      return svg;
    } finally {
      container.remove();
    }
  });
  serial = result.then(
    () => {},
    () => {},
  );
  return result;
}
