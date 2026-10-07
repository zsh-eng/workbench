let serial = Promise.resolve();
let sequence = 0;
const cache = new Map<string, string>();

/** Mermaid's base theme in the current Med theme's colors, so diagrams match
 * the page instead of Mermaid's own dark or neutral palette. */
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
  const canvas = color("canvas", dark ? "#141416" : "#ffffff");
  return {
    darkMode: dark,
    fontFamily: "Geist, sans-serif",
    fontSize: "13px",
    background: canvas,
    primaryColor: raised,
    primaryTextColor: text,
    primaryBorderColor: border,
    secondaryColor: color("hover", raised),
    tertiaryColor: color("panel", canvas),
    lineColor: muted,
    textColor: text,
    edgeLabelBackground: canvas,
    clusterBkg: color("panel", canvas),
    clusterBorder: border,
    noteBkgColor: color("selected", raised),
    noteTextColor: text,
    noteBorderColor: border,
    actorBkg: raised,
    actorBorder: border,
    actorTextColor: text,
    actorLineColor: border,
    signalColor: muted,
    signalTextColor: text,
    labelBoxBkgColor: raised,
    labelBoxBorderColor: border,
    labelTextColor: text,
    loopTextColor: text,
  };
}

/** Mermaid uses shared configuration. Serialize renders and retain unchanged diagrams. */
export function renderDiagram(source: string, dark: boolean) {
  const variables = themeVariables(dark);
  const key = `${JSON.stringify(variables)}:${source}`;
  const known = cache.get(key);
  if (known) return Promise.resolve(known);
  const result = serial.then(async () => {
    if (cache.has(key)) return cache.get(key)!;
    if (source.length > 20_000) throw new Error("Diagram exceeds the 20,000 character limit.");
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
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
