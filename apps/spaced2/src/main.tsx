import App from "@/App";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// KaTeX's CSS loads with the first card that has maths (lib/markdown/cards.ts).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
