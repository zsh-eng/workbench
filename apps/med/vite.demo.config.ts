// Builds Med's live demo for the website (src/web/demo.ts): the web app with
// relative asset paths, so it runs from any folder. MED_DEMO_OUT sets where.
// Recorded drawings stand in for Mermaid (src/web/demo-diagrams.ts).
import { fileURLToPath } from "node:url";
import { mergeConfig } from "vite";
import app from "./vite.config.ts";

export default mergeConfig(app, {
  base: "./",
  resolve: {
    alias: { mermaid: fileURLToPath(new URL("./src/web/demo-diagrams.ts", import.meta.url)) },
  },
  build: {
    outDir: process.env.MED_DEMO_OUT ?? "dist/demo",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: "demo.html" },
  },
});
