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
 * Draws a diagram in `element`. Pele keeps it fitted to the element's width
 * (a narrow pane can turn a left-to-right flowchart downward) and offers zoom
 * when a diagram has to shrink. Rejects when the source does not draw, so the
 * caller shows it as code; Pele's own error text stays out of the page.
 */
export async function mountDiagram(element: HTMLElement, source: string): Promise<Mounted> {
  const { mountAsync } = await import("pele/lazy");
  const mounted = await mountAsync(element, source, OPTIONS);
  if (mounted.error !== undefined) {
    mounted.destroy();
    element.replaceChildren();
    throw mounted.error;
  }
  return mounted;
}
