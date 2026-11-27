let loaded: Promise<unknown> | undefined;
let ready = false;

/** True once KaTeX's stylesheet has loaded into this document. */
export const katexStylesReady = () => ready;

/** Loads KaTeX's stylesheet and math fonts once on demand before formulas paint. */
export function ensureKatexStyles(): Promise<unknown> {
  if (ready) return Promise.resolve();
  return (loaded ??= import("katex/dist/katex.min.css").then(
    (mod) => {
      ready = true;
      return mod;
    },
    (error) => {
      loaded = undefined;
      throw error;
    },
  ));
}
