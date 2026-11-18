import { vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import type { BrowseRead } from "../../src/shared/browse";
import { type FileComments } from "../../src/web/components/FullFileView";
import type { FileComment } from "../../src/shared/saved-review";
import type { SymbolDefinition, SymbolHover } from "../../src/shared/symbols";
import { initializeTheme } from "../../src/web/themes";

// A file's full view (FullFileView) in the page, for the full-file*.test.tsx
// files: a frame to render it in, and how to read its rows and ranges.

export let root: Root | undefined;
export let mount: HTMLDivElement | undefined;
/** Unmounts the view and restores what a test spied on. */
export function cleanUp() {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
  vi.restoreAllMocks();
}
/** Unmounts the view, as when its tab closes. */
export function unmount() {
  root?.unmount();
  root = undefined;
}
export function render(element: React.ReactNode) {
  initializeTheme();
  mount = document.createElement("div");
  mount.style.cssText = "height:420px;width:900px;display:flex;flex-direction:column";
  document.body.append(mount);
  root = createRoot(mount);
  root.render(element);
}
export const base: BrowseRead = {
  source: { kind: "worktree", repo: "/fixture" },
  path: "src/example.ts",
  kind: "text",
  size: 30,
  identity: "example:1",
  text: "export const example = true;\n",
};
export const noop = () => {};
export const props = {
  loading: false,
  error: null,
  sourceLabel: "feature/review",
  onRefresh: noop,
};
export function lines() {
  return document.querySelector("diffs-container")?.shadowRoot?.querySelectorAll("[data-line]");
}

export function searchRanges() {
  return Array.from(CSS.highlights)
    .filter(([name]) => name.startsWith("med-search-"))
    .flatMap(([, highlight]) => Array.from(highlight) as Range[]);
}

// Pierre names Crystal files, but its highlighter has no Crystal grammar.

/** Keys per benchmark scenario: enough for the suite to check that the
 * cursor keeps up and the rows stay bounded. A measurement for
 * docs/validation (scripts/visual-benchmark-reporter.mjs) takes more. */
export const BENCHMARK_SAMPLES = 16;

export function visualRanges() {
  return [...CSS.highlights].filter(([name]) => name.startsWith("med-visual-"));
}

// Keep edge cases on the file-pane path: key events -> navigation -> rendered
// selection -> clipboard. Only the external clipboard is replaced.

export function commentProps(threads: FileComment[] = []) {
  return {
    threads,
    unsent: new Set<string>(),
    agent: { name: "Claude", mark: "claude" as const },
    add: vi.fn<FileComments["add"]>(async () => {}),
    mutate: vi.fn<FileComments["mutate"]>(async () => {}),
    send: vi.fn<FileComments["send"]>(async () => {}),
  };
}
export const fourLines = "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n";

export function hoverProps() {
  const definition: SymbolDefinition = {
    name: "retries",
    kind: "constant",
    path: "src/limits.ts",
    line: 3,
    source: { kind: "worktree", repo: "/fixture" },
    signature: ["export const retries = 3;"],
    doc: ["How often a request goes again, as `fetch` does."],
  };
  return {
    loadHover: vi.fn<(name: string, signal: AbortSignal) => Promise<SymbolHover>>(async (name) => ({
      source: base.source,
      path: base.path,
      identity: "hover:1",
      name,
      definitions: name === "retries" ? [definition] : [],
      more: 0,
    })),
    onOpenDefinition: vi.fn<(definition: SymbolDefinition) => void>(),
    definition,
  };
}
export const hoverText = "const total = retries + 1;\nconst unknown = other;\n";
