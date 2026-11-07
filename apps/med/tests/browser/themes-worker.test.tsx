import { afterEach, expect, test } from "vitest";
import { useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CodeView, WorkerPoolContextProvider, useWorkerPool } from "@pierre/diffs/react";
import { parsePatchFiles } from "@pierre/diffs";
import PierreWorker from "@pierre/diffs/worker/worker.js?worker";
import { PierreThemeSync } from "../../src/web/pierre-theme";
import {
  findTheme,
  initializeTheme,
  THEME_STORAGE_KEY,
  themeController,
  useTheme,
} from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
let workerPool: ReturnType<typeof useWorkerPool>;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
  workerPool = undefined;
  localStorage.removeItem(THEME_STORAGE_KEY);
  initializeTheme();
});

const fileDiff = parsePatchFiles(
  `diff --git a/example.ts b/example.ts
index 1111111..2222222 100644
--- a/example.ts
+++ b/example.ts
@@ -1,2 +1,2 @@
-export const greeting = "before";
+export const greeting = "after";
 export function hello() { return greeting; }
`,
  { cacheKeyPrefix: "theme-worker-fixture" },
)[0].files[0];
const file = {
  name: "example.ts",
  contents: 'export const greeting = "after";\nexport function hello() { return greeting; }\n',
  cacheKey: "theme-worker-file",
};
const diffItems = [{ id: "example", type: "diff" as const, fileDiff }];
const fileItems = [{ id: "example", type: "file" as const, file }];
type View = "file" | "diff";
const poolOptions = { workerFactory: () => new PierreWorker(), poolSize: 1 };

function Review({ view }: { view: View }) {
  const pool = useWorkerPool();
  useEffect(() => {
    workerPool = pool;
  }, [pool]);
  const { active } = useTheme();
  return (
    <CodeView
      items={view === "file" ? fileItems : diffItems}
      options={{ theme: active.pierreTheme, themeType: active.appearance }}
      style={{ height: 300, width: 700 }}
    />
  );
}

function codeHost() {
  return document.querySelector("diffs-container");
}
function tokenColors() {
  return Array.from(codeHost()?.shadowRoot?.querySelectorAll("[data-line] span") ?? [])
    .filter((node) => node.children.length === 0 && node.textContent?.trim())
    .map((node) => `${node.textContent}:${getComputedStyle(node).color}`)
    .join("|");
}
function expectedColor(hex: string) {
  const element = document.createElement("div");
  element.style.backgroundColor = hex;
  return element.style.backgroundColor;
}

// This is a correctness check. Initial worker/theme modules can take more than
// the default one-second poll while other browser suites run in parallel.
const renderReady = { timeout: 5000 };
async function expectRenderedTheme(id: string, view: View) {
  const theme = findTheme(id);
  // A plain first paint is not proof that the worker has applied this theme.
  await expect
    .poll(
      () =>
        (view === "file"
          ? workerPool?.getFileResultCache(file)
          : workerPool?.getDiffResultCache(fileDiff)
        )?.options.theme,
      renderReady,
    )
    .toBe(theme.pierreTheme);
  await expect
    .poll(() => codeHost() && getComputedStyle(codeHost()!).backgroundColor, renderReady)
    .toBe(expectedColor(theme.palette.canvas));
  await expect.poll(tokenColors, renderReady).toContain("greeting:");
}

test.each(["file", "diff"] as const)(
  "live theme changes reach real worker-backed %s backgrounds and syntax",
  { timeout: 30000 },
  async (view) => {
    localStorage.setItem(THEME_STORAGE_KEY, "graphite-dark");
    initializeTheme();
    mount = document.createElement("div");
    document.body.append(mount);
    root = createRoot(mount);
    root.render(
      <WorkerPoolContextProvider
        poolOptions={poolOptions}
        highlighterOptions={{ theme: "med-graphite-dark", preferredHighlighter: "highlights" }}
      >
        <PierreThemeSync />
        <Review view={view} />
      </WorkerPoolContextProvider>,
    );
    await expect.poll(() => workerPool, renderReady).toBeDefined();
    await workerPool!.initialize();
    await expectRenderedTheme("graphite-dark", view);
    expect(workerPool?.isWorkingPool()).toBe(true);
    expect(workerPool?.isInitialized()).toBe(true);
    const originalPool = workerPool;
    const graphiteTokens = tokenColors();
    themeController.preview("tokyo-night");
    await expectRenderedTheme("tokyo-night", view);
    await expect.poll(tokenColors, renderReady).not.toBe(graphiteTokens);
    const tokyoTokens = tokenColors();
    themeController.preview("rose-pine");
    await expectRenderedTheme("rose-pine", view);
    await expect.poll(tokenColors, renderReady).not.toBe(tokyoTokens);
    themeController.cancelPreview();
    await expectRenderedTheme("graphite-dark", view);
    await expect.poll(tokenColors, renderReady).toBe(graphiteTokens);
    expect(workerPool).toBe(originalPool);
  },
);
