// Builds Med's live demo for the website (src/web/demo.ts): the web app with
// relative asset paths, so it runs from any folder. MED_DEMO_OUT sets where.
import { mergeConfig } from "vite";
import app from "./vite.config.ts";

export default mergeConfig(app, {
  base: "./",
  build: {
    outDir: process.env.MED_DEMO_OUT ?? "dist/demo",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: "demo.html" },
  },
});
