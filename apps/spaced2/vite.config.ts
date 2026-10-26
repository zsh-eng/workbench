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
      // The app registers the worker itself (src/lib/app-update.ts) and
      // decides when a new version takes over: never during a review.
      registerType: "prompt",
      injectRegister: false,
      workbox: {
        // A new version waits after it installs, keeping this version's
        // files, and takes over when the page posts SKIP_WAITING.
        skipWaiting: false,
        clientsClaim: true,
        navigateFallbackDenylist: [/^\/api(?:\/|$)/],
        globPatterns: [
          "**/*.{js,css,html}",
          // The page's own icons, and the one that Add to Home Screen takes
          // on iOS. Browsers fetch the manifest's icons when they install,
          // so of those only the two that every install uses are here.
          "{favicon.ico,telescope.svg,apple-touch-icon-180x180.png,pwa-192x192.png,pwa-512x512.png}",
        ],
        // The Elements page is a development tool; installs do not fetch it.
        globIgnores: ["**/node_modules/**/*", "**/ElementsRoutes-*.js"],
        runtimeCaching: [
          {
            // Built files outside the precache: KaTeX's fonts, which only
            // cards with maths use, and the Elements page. Names carry a
            // content hash, so a cached copy never goes stale.
            urlPattern: ({ sameOrigin, url }) =>
              sameOrigin &&
              /^\/assets\/.+\.(js|css|woff2|woff|ttf)$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "spaced-assets",
              expiration: { maxEntries: 60, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      // The icons come from `globPatterns`.
      includeManifestIcons: false,
      manifest: {
        // Chrome's identity for an install: the start URL it used before.
        id: "/",
        name: "Spaced",
        short_name: "Spaced",
        description: "Spaced is an app for spaced repetition using flashcards",
        theme_color: "#06B6D4",
        // Android's splash screen: the light page colour (bg-muted).
        background_color: "#f5f5f5",
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
        // Chrome's richer install dialog. Not precached.
        screenshots: [
          {
            src: "/screenshots/review-wide.jpg",
            sizes: "1280x757",
            type: "image/jpeg",
            form_factor: "wide",
            label: "A card to review, with its answer beside it",
          },
          {
            src: "/screenshots/review-narrow.jpg",
            sizes: "780x1540",
            type: "image/jpeg",
            form_factor: "narrow",
            label: "A card to review on a phone",
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
