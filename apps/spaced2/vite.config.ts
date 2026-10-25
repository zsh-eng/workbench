import react from "@vitejs/plugin-react-swc";
import path from "path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

type ModuleInfo = {
  isEntry: boolean;
  importers: readonly string[];
} | null;

/** Whether static imports alone reach this module from an entry. */
function loadsWithEntry(id: string, getModuleInfo: (id: string) => ModuleInfo) {
  const seen = new Set([id]);
  const queue = [id];
  for (const next of queue) {
    const info = getModuleInfo(next);
    if (info?.isEntry) return true;
    for (const importer of info?.importers ?? [])
      if (!seen.has(importer)) {
        seen.add(importer);
        queue.push(importer);
      }
  }
  return false;
}

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
        // Packages that the first load needs share a vendor chunk; packages
        // that only lazy screens import stay with those screens.
        manualChunks(id, { getModuleInfo }) {
          if (id.includes("node_modules") && loadsWithEntry(id, getModuleInfo))
            return "vendor";
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
