import type { Mounted } from "pele/lazy";

// Mermaid diagrams, drawn by Pele (github.com/obsidianmd/pele), as in Med.
// It reads Mermaid's syntax, draws in well under a millisecond, and takes its
// colors from CSS variables, so a theme change restyles a diagram without
// drawing it again; index.css maps them to Spaced's tokens. Each diagram type
// loads on demand.

const OPTIONS = {
  fontSize: 14,
  padding: 4,
  limit: 20_000,
  // A link would take the review away, and an image would load from the
  // network past the image cache.
  links: false,
  images: false,
};

/**
 * Draws a diagram in `element`. Pele keeps it fitted to the element's width
 * (a narrow card can turn a left-to-right flowchart downward) and offers
 * zoom when a diagram has to shrink. Rejects when the source does not draw,
 * so the caller shows it as code. `zoom` keeps Pele's zoom on, up to
 * `maxScale`, also for a diagram that fits.
 */
export async function mountDiagram(
  element: HTMLElement,
  source: string,
  { zoom }: { zoom?: { maxScale: number } } = {},
): Promise<Mounted> {
  const { mountAsync } = await import("pele/lazy");
  const mounted = await mountAsync(element, source, {
    ...OPTIONS,
    ...(zoom ? { zoom: { always: true, maxScale: zoom.maxScale } } : {}),
  });
  if (mounted.error !== undefined) {
    mounted.destroy();
    element.replaceChildren();
    throw mounted.error;
  }
  return mounted;
}

export type DiagramOpen = (
  source: string,
  natural?: { width: number; height: number },
) => void;

const EXPAND_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';

/**
 * Draws each `<pre data-mermaid>` that the Markdown worker left in `root`.
 * A drawn diagram replaces its source and gets a Full screen button that
 * calls `open`; a source that does not draw stays as code. Returns a
 * cleanup that puts the blocks back as the worker made them.
 */
export function drawDiagrams(root: HTMLElement, open: DiagramOpen) {
  const undo: (() => void)[] = [];
  let cancelled = false;
  for (const pre of root.querySelectorAll<HTMLPreElement>(
    "pre[data-mermaid]",
  )) {
    const source = pre.querySelector("code")?.textContent?.replace(/\n$/, "");
    if (!source) continue;
    const target = document.createElement("div");
    target.className = "card-diagram";
    pre.prepend(target);
    pre.dataset.drawing = "true";
    let mounted: Mounted | undefined;
    let button: HTMLButtonElement | undefined;
    mountDiagram(target, source).then(
      (diagram) => {
        if (cancelled) return diagram.destroy();
        mounted = diagram;
        button = document.createElement("button");
        button.type = "button";
        button.className = "card-diagram-expand";
        button.title = "Full screen";
        button.setAttribute("aria-label", "Show the diagram full screen");
        button.innerHTML = EXPAND_ICON;
        button.onclick = (event) => {
          // A tap on the card would otherwise reach the carousel or the
          // card form's preview.
          event.stopPropagation();
          const drawn = mounted?.result;
          open(source, drawn && { width: drawn.width, height: drawn.height });
        };
        pre.append(button);
        delete pre.dataset.drawing;
        pre.dataset.rendered = "true";
      },
      () => {
        if (cancelled) return;
        target.remove();
        delete pre.dataset.drawing;
        pre.dataset.diagramError = "true";
      },
    );
    undo.push(() => {
      mounted?.destroy();
      target.remove();
      button?.remove();
      delete pre.dataset.drawing;
      delete pre.dataset.rendered;
      delete pre.dataset.diagramError;
    });
  }
  return () => {
    cancelled = true;
    undo.forEach((step) => step());
  };
}
