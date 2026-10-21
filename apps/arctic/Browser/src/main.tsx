import { Tooltip } from "@base-ui/react/tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applySettings } from "./settings";
import "./styles.css";

// Startup marks time a launch in a trace: arctic:script once every module has
// run, arctic:open when the library is read, arctic:cards at the first cards.
performance.mark("arctic:script");
applySettings();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Tooltip.Provider delay={500}>
      <App />
    </Tooltip.Provider>
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD)
  void navigator.serviceWorker.register("/sw.js");
