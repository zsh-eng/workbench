import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Tooltip } from "@base-ui/react/tooltip";
import { App } from "./App";
import { initialize } from "./store";
import "./styles.css";
import "./typography.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Tooltip.Provider delay={300}>
        <App />
      </Tooltip.Provider>
    </BrowserRouter>
  </React.StrictMode>,
);
void initialize();
