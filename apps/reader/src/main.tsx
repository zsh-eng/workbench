import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";

// Inter sets interface figures (--font-numeric).
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";

import "@fontsource/eb-garamond/400.css";
import "@fontsource/eb-garamond/500.css";
import "@fontsource/eb-garamond/600.css";
import "@fontsource/eb-garamond/400-italic.css";

import "@fontsource/lora/400.css";
import "@fontsource/lora/500.css";
import "@fontsource/lora/600.css";
import "@fontsource/lora/400-italic.css";

import "@fontsource/jetbrains-mono/400.css";

// Sans reading fonts: the Latin subsets in the weights the Reader sets (body,
// italic, headings, bold). Latin follows Latin Extended so it takes the
// characters both cover, as in Fontsource's own stylesheets. The pagination
// worker loads the same stylesheets (pagination-v2/worker/fonts.ts).
import "@fontsource/source-sans-3/latin-ext-400.css";
import "@fontsource/source-sans-3/latin-400.css";
import "@fontsource/source-sans-3/latin-ext-400-italic.css";
import "@fontsource/source-sans-3/latin-400-italic.css";
import "@fontsource/source-sans-3/latin-ext-600.css";
import "@fontsource/source-sans-3/latin-600.css";
import "@fontsource/source-sans-3/latin-ext-700.css";
import "@fontsource/source-sans-3/latin-700.css";

import "@fontsource/atkinson-hyperlegible-next/latin-ext-400.css";
import "@fontsource/atkinson-hyperlegible-next/latin-400.css";
import "@fontsource/atkinson-hyperlegible-next/latin-ext-400-italic.css";
import "@fontsource/atkinson-hyperlegible-next/latin-400-italic.css";
import "@fontsource/atkinson-hyperlegible-next/latin-ext-600.css";
import "@fontsource/atkinson-hyperlegible-next/latin-600.css";
import "@fontsource/atkinson-hyperlegible-next/latin-ext-700.css";
import "@fontsource/atkinson-hyperlegible-next/latin-700.css";

import "./index.css";
import { listenForInstallPrompt } from "./features/install/install-prompt";

// Chromium's install prompt can fire before the app renders, and only once.
listenForInstallPrompt();

/** Configure isolated clients before app modules create their singleton services. */
async function bootstrap() {
  const root = createRoot(document.getElementById("root")!);
  const id = new URLSearchParams(location.search).get("labClient");
  if (id) {
    if (window.parent === window || !window.parent.__syncLabHost)
      throw new Error("Open this client from Sync Lab.");
    const { configureLabRuntime } = await import("./features/sync-lab/runtime");
    const runtime = window.parent.__syncLabHost.connect(id);
    configureLabRuntime(runtime);
    const { onlineManager } = await import("@tanstack/react-query");
    // Query recovery must follow this client, even while the host is online.
    onlineManager.setOnline(runtime.isOnline());
    onlineManager.setEventListener((setOnline) =>
      runtime.subscribeOnline(() => setOnline(runtime.isOnline())),
    );
    const { startLabClient } = await import("./features/sync-lab/client");
    let stopped = false;
    await startLabClient(id, () => {
      stopped = true;
      root.unmount();
      // Headless clients have no QueryClientProvider to release this listener.
      onlineManager.setEventListener(() => () => {});
    });
    if (new URLSearchParams(location.search).get("labMode") === "app") {
      const { default: App } = await import("./App");
      if (!stopped) root.render(<App />);
    }
    return;
  }
  if (location.pathname === "/debug/sync") {
    const { default: SyncLab } = await import("./features/sync-lab/SyncLab");
    root.render(<SyncLab />);
    return;
  }
  const [{ default: App }, { deleteLegacyClientDatabase }] = await Promise.all([
    import("./App"),
    import("./lib/sync-v2/db"),
  ]);
  void deleteLegacyClientDatabase().catch((error: unknown) =>
    console.error("Could not delete the legacy client database:", error),
  );
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void bootstrap().catch((error) => {
  console.error("Application startup failed", error);
  const element = document.getElementById("root");
  if (element)
    element.textContent =
      error instanceof Error ? error.message : String(error);
});
