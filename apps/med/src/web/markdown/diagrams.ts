let serial = Promise.resolve();
let sequence = 0;
const cache = new Map<string, string>();
/** Mermaid uses shared configuration. Serialize renders and retain unchanged diagrams. */
export function renderDiagram(source: string, dark: boolean) {
  const key = `${dark}:${source}`;
  const known = cache.get(key);
  if (known) return Promise.resolve(known);
  const result = serial.then(async () => {
    if (cache.has(key)) return cache.get(key)!;
    if (source.length > 20_000) throw new Error("Diagram exceeds the 20,000 character limit.");
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "neutral",
      fontFamily: "Geist, sans-serif",
      maxTextSize: 20_000,
      maxEdges: 500,
      suppressErrorRendering: true,
    });
    const container = document.createElement("div");
    container.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;visibility:hidden";
    document.body.append(container);
    try {
      const { svg } = await mermaid.render(`med-diagram-${++sequence}`, source, container);
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
