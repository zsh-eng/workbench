import { createRoot } from "react-dom/client";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import PierreWorker from "@pierre/diffs/worker/worker.js?worker";
import { initializeTheme, themeController } from "./themes";
import { VaultWorkspace } from "./components/VaultWorkspace";
import { LocalFiles } from "./components/LocalFiles";
import { App } from "./App";
import { PierreThemeSync } from "./pierre-theme";
import { authorizeBrowser } from "./data/auth";
import { createReviewController } from "./data/controller";
import { createPatchParser } from "./workers/client";
import "./reset.css";

if (import.meta.env.DEV) {
  void import("virtual:stylex:runtime");
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "/virtual:stylex.css";
  document.head.append(css);
}

await authorizeBrowser().catch(() => {});
initializeTheme();
const parser = createPatchParser();
const controller = createReviewController({ parsePatch: parser.parse });
const poolOptions = {
  workerFactory: () => new PierreWorker(),
  poolSize: Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)),
  totalASTLRUCacheSize: 80,
};
const highlighterOptions = { theme: themeController.getSnapshot().active.pierreTheme };
const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing");
createRoot(root).render(
  <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
    <PierreThemeSync />
    <VaultWorkspace>
      <LocalFiles>
        <App controller={controller} />
      </LocalFiles>
    </VaultWorkspace>
  </WorkerPoolContextProvider>,
);
window.addEventListener(
  "pagehide",
  () => {
    controller.dispose();
    parser.dispose();
  },
  { once: true },
);
