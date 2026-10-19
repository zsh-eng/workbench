import { Tooltip } from "@base-ui/react/tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Tooltip.Provider delay={500}>
      <App />
    </Tooltip.Provider>
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD)
  void navigator.serviceWorker.register("/sw.js");
