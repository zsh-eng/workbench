// Mermaid's stand-in in the website's live demo (vite.demo.config.ts), so the
// marketing page does not load Mermaid and its layout engines. The screenshot
// script records each diagram as Med drew it, in Med Dawn and Med Night, and
// demo.ts puts those drawings here. A diagram that was not recorded fails, and
// Med shows its source.

export interface Drawing {
  dark: boolean;
  source: string;
  /** The id that Mermaid gave the drawing; its styles are scoped to it. */
  id: string;
  svg: string;
}

const drawings = new Map<string, Drawing>();
const key = (dark: boolean, source: string) => `${dark ? "dark" : "light"}:${source.trim()}`;
let dark = false;

export function addDrawing(drawing: Drawing) {
  drawings.set(key(drawing.dark, drawing.source), drawing);
}

export default {
  initialize(config: { themeVariables?: { darkMode?: boolean } }) {
    dark = config.themeVariables?.darkMode ?? false;
  },
  async render(id: string, source: string) {
    const drawing = drawings.get(key(dark, source));
    if (!drawing) throw new Error("The demo has no drawing of this diagram.");
    return { svg: drawing.svg.replaceAll(drawing.id, id) };
  },
};
