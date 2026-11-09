/**
 * A card side as HTML, from the Markdown worker (render.worker.ts).
 *
 * - `html` has no network image sources: each image keeps its URL in
 *   `data-cache-src` until the local image cache answers.
 * - `images` lists those URLs, for the review preloader.
 * - `diagrams` lists the Mermaid sources. Their blocks are
 *   `<pre data-mermaid>` with the source as code; the page draws them
 *   (diagrams.ts).
 * - `math` is true when the HTML has KaTeX output, which needs KaTeX's CSS.
 */
export interface RenderedCard {
  html: string;
  images: string[];
  diagrams: string[];
  math: boolean;
}

const escapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/** The source as text, for a card whose Markdown could not render. */
export function plainCard(text: string): RenderedCard {
  return {
    html: `<p class="card-plain">${text.replace(/[&<>"]/g, (c) => escapes[c])}</p>`,
    images: [],
    diagrams: [],
    math: false,
  };
}
