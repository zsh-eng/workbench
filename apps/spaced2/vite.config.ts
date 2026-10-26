import react from "@vitejs/plugin-react-swc";
import path from "path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

type ModuleInfo = {
  isEntry: boolean;
  importers: readonly string[];
  dynamicImporters: readonly string[];
} | null;

/** The Elements page is a development tool: it may import anything. */
const ELEMENTS = /\/src\/elements\//;

/** Whether static imports alone reach this module from a module that `starts`. */
function reachedFrom(
  id: string,
  getModuleInfo: (id: string) => ModuleInfo,
  starts: (id: string, info: NonNullable<ModuleInfo>) => boolean,
) {
  const seen = new Set([id]);
  const queue = [id];
  for (const next of queue) {
    const info = getModuleInfo(next);
    if (!info) continue;
    if (starts(next, info)) return true;
    for (const importer of info.importers)
      if (!seen.has(importer)) {
        seen.add(importer);
        queue.push(importer);
      }
  }
  return false;
}

const loadsWithEntry = (
  id: string,
  getModuleInfo: (id: string) => ModuleInfo,
) => reachedFrom(id, getModuleInfo, (_, info) => info.isEntry);

/** A lazy screen (a dynamic import's target) other than Elements loads it. */
const loadsWithScreen = (
  id: string,
  getModuleInfo: (id: string) => ModuleInfo,
) =>
  reachedFrom(
    id,
    getModuleInfo,
    (next, info) => info.dynamicImporters.length > 0 && !ELEMENTS.test(next),
  );

// https://vite.dev/config/
export default defineConfig({
  server: { proxy: { "/api": "http://127.0.0.1:8791" } },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        navigateFallbackDenylist: [/^\/api(?:\/|$)/],
        // The Elements page is a development tool; installs do not fetch it.
        globIgnores: ["**/node_modules/**/*", "**/ElementsRoutes-*.js"],
      },
      manifest: {
        name: "Spaced",
        short_name: "Spaced",
        description: "Spaced is an app for spaced repetition using flashcards",
        theme_color: "#06B6D4",
        icons: [
          {
            src: "pwa-64x64.png",
            sizes: "64x64",
            type: "image/png",
          },
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        screenshots: [
          {
            src: "/screenshots/desktop.png",
            sizes: "3024x1890",
            type: "image/png",
            form_factor: "wide",
          },
          {
            src: "/screenshots/mobile.png",
            sizes: "852x1724",
            type: "image/png",
          },
        ],
      },
    }),
  ],
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        // Packages that the first load needs share a vendor chunk, with the
        // bundler's helpers; packages that only lazy screens import stay with
        // those screens.
        //
        // The entry chunk names every lazy file, so its name changes with
        // every release. A lazy screen that imported from it would change
        // too, and so would the charts it imports. The app code that Stats
        // shares with the first load has its own chunk instead, which
        // changes only when that code does.
        manualChunks(id, { getModuleInfo }) {
          if (id.includes("node_modules") || id.startsWith("\0"))
            return loadsWithEntry(id, getModuleInfo) ? "vendor" : undefined;
          if (
            loadsWithEntry(id, getModuleInfo) &&
            loadsWithScreen(id, getModuleInfo)
          )
            return "shared";
        },
      },
    },
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
