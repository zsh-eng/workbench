import { preloadable } from "@/lib/prefetch";

type ReaderModule = typeof import("./Reader");

/** Marked once the Reader's code has loaded and run. */
export const READER_CODE_READY_MARK = "reader-code-ready";

let importReader = (): Promise<ReaderModule> =>
  Promise.reject(new Error("main.tsx sets how the Reader loads."));

/**
 * Sets how the Reader's code loads; only the entry, `main.tsx`, calls this.
 * The chunk that holds the `import()` names the Reader's file, so a Reader
 * release renames it and every chunk that imports it. Nothing imports the
 * entry, and this module keeps a chunk of its own (`vite.config.ts`), so a
 * Reader release leaves the Library's chunks alone.
 */
export function setReaderImport(load: () => Promise<ReaderModule>): void {
  importReader = load;
}

/**
 * The Reader's code, out of the bundle the Library paints with. The Library
 * loads it once it has painted and is idle, and again at once when a pointer
 * or focus reaches a book, so opening a book downloads and parses nothing.
 * A launch straight into a book starts it beside the app (`main.tsx`).
 */
export const loadReader = preloadable(() =>
  importReader().then((module) => {
    performance.mark(READER_CODE_READY_MARK);
    return module;
  }),
);

/** Starts loading the Reader in the background. The route reports a failure. */
export function preloadReader(): void {
  loadReader().catch(() => {});
}
