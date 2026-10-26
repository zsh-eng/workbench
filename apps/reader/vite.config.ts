import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { readerBackupApi } from "./scripts/local-data/backup-api";
import { livingCoversDev } from "./scripts/living-covers/dev-plugin";

/**
 * The service worker's precache list with sizes, written beside it on build
 * as `sw-precache.json`. While a new version installs, the page counts these
 * entries in Cache Storage to show the update's progress.
 */
function precacheList(): {
  plugin: Plugin;
  transform: (
    entries: { url: string; revision: string | null; size: number }[],
  ) => Promise<{ manifest: typeof entries }>;
} {
  let outDir: string | null = null;
  return {
    plugin: {
      name: "reader-precache-list",
      apply: "build",
      configResolved(config) {
        outDir = path.resolve(config.root, config.build.outDir);
      },
    },
    async transform(entries) {
      if (outDir) {
        mkdirSync(outDir, { recursive: true });
        writeFileSync(
          path.join(outDir, "sw-precache.json"),
          JSON.stringify(
            entries.map(({ url, revision, size }) => ({ url, revision, size })),
          ),
        );
      }
      return { manifest: entries };
    },
  };
}

const precache = precacheList();

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => ({
  cacheDir: process.env.VITE_SHARED_API_URL
    ? "node_modules/.vite-shared"
    : undefined,
  optimizeDeps: {
    exclude: ["@jsquash/webp"],
    // The PWA plugin imports this from a virtual module, which the startup
    // scan does not follow. Found later, it rebuilds the dependency cache and
    // fails the module requests already in flight on a cold start.
    include: ["workbox-window"],
  },
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
    tailwindcss(),
    precache.plugin,
    VitePWA({
      // The app registers the worker itself (src/lib/app-update.ts) and
      // decides when a new version takes over. Isolated debug frames never
      // register one.
      registerType: "prompt",
      injectRegister: false,
      devOptions: {
        enabled: true,
      },
      workbox: {
        // Built-in document and pagination-worker fonts must be available from
        // CacheStorage on repeat launches, without an HTTP cache revalidation.
        // Every browser that runs the service worker takes the woff2 source,
        // so the woff fallbacks Fontsource also emits stay out.
        globPatterns: ["**/*.{js,css,html,woff2}"],
        // A new version waits after it installs, keeping this version's files,
        // and takes over when the page posts SKIP_WAITING: at once by
        // default, at a safe moment with Debug -> Calm updates.
        skipWaiting: false,
        clientsClaim: true,
        manifestTransforms: [precache.transform],
        navigateFallbackDenylist: [/^\/api\//],
        globIgnores: [
          "**/assets/encode-*.js",
          "**/assets/webp_enc*.js",
          "**/assets/webp_enc*.wasm",
        ],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-stylesheets",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png"],
      manifest: {
        name: "Reader",
        short_name: "Reader",
        description: "A modern ebook reader",
        theme_color: "#ffffff",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
    // Hand-made scenes for the user's own covers: dev only, never built.
    livingCoversDev(),
    // `--mode local-data` serves the local backup in place of the Worker.
    ...(mode === "local-data"
      ? [readerBackupApi(process.env.READER_BACKUP_DIR)]
      : command === "serve" && process.env.VITE_SHARED_API_URL
        ? []
        : [cloudflare()]),
  ],
  build: {
    outDir: "dist",
  },
  environments: {
    client: {
      build: {
        rolldownOptions: {
          output: {
            advancedChunks: {
              groups: [
                {
                  // Nearly every chunk imports React and the bundler's
                  // helpers. Kept out of the entry chunk, which names every
                  // page's file, they keep their file names across releases,
                  // and so do the chunks that import them.
                  name: "framework",
                  test: /node_modules[\\/](react|react-dom|scheduler)[\\/]|vite\/preload-helper/,
                },
              ],
            },
          },
        },
      },
    },
  },
  resolve: {
    // Workspace packages with a React peer (local-sync/react, elements,
    // activity-time) must use this app's React, not the copy linked beside
    // the package, which can be another version.
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@server": path.resolve(__dirname, "./server"),
    },
  },
  server: {
    allowedHosts: ["fe-dev.zsheng.app", "pc.zsheng.app"],
  },
}));
