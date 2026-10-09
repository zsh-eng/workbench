import { Tooltip } from "@base-ui/react/tooltip";
import { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import PierreWorker from "@pierre/diffs/worker/worker.js?worker";
import { initializeTheme, themeController } from "./themes";
import { VaultWorkspace } from "./components/VaultWorkspace";
import { LocalFiles } from "./components/LocalFiles";
import { App } from "./App";
import { PierreThemeSync } from "./pierre-theme";
import { UpdateNotice } from "./components/UpdateNotice";
import { WorkspaceHost, WorkspaceViews } from "./components/Workspaces";
import { authorizeBrowser } from "./data/auth";
import { rememberWelcome, routeFirstRun, WELCOME_PATH } from "./data/setup";
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
await routeFirstRun();
initializeTheme();
const parser = createPatchParser();
const controllerOptions = { parsePatch: parser.parse };
const poolOptions = {
  workerFactory: () => new PierreWorker(),
  poolSize: Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)),
  totalASTLRUCacheSize: 80,
};
const highlighterOptions = { theme: themeController.getSnapshot().active.pierreTheme };
const Welcome = lazy(() => import("./components/welcome/Welcome"));
const ElementsPage = lazy(() => import("./components/elements/ElementsPage"));

/** The welcome replaces the app while it shows; leaving it starts the app. */
function Root() {
  const [welcome, setWelcome] = useState(() => location.pathname === WELCOME_PATH);
  useEffect(() => {
    const follow = () => setWelcome(location.pathname === WELCOME_PATH);
    addEventListener("popstate", follow);
    return () => removeEventListener("popstate", follow);
  }, []);
  if (location.pathname === "/elements")
    return (
      <Suspense fallback={null}>
        <ElementsPage />
      </Suspense>
    );
  if (welcome)
    return (
      <Suspense fallback={null}>
        <Welcome
          onFinish={(url) => {
            rememberWelcome();
            history.replaceState(null, "", url);
            setWelcome(false);
          }}
        />
      </Suspense>
    );
  return (
    <WorkspaceHost>
      <VaultWorkspace>
        <LocalFiles>
          <WorkspaceViews options={controllerOptions}>
            {(controller) => <App controller={controller} />}
          </WorkspaceViews>
        </LocalFiles>
      </VaultWorkspace>
    </WorkspaceHost>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing");
createRoot(root).render(
  <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
    <Tooltip.Provider delay={400} closeDelay={80} timeout={500}>
      <PierreThemeSync />
      <UpdateNotice />
      <Root />
    </Tooltip.Provider>
  </WorkerPoolContextProvider>,
);
window.addEventListener("pagehide", () => parser.dispose(), { once: true });
