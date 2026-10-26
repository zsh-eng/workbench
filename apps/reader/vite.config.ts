import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { readerBackupApi } from "./scripts/local-data/backup-api";
import { livingCoversDev } from "./scripts/living-covers/dev-plugin";
import { readerPrecache } from "./scripts/pwa/precache";

const precache = readerPrecache({
  // Debug pages and labs download on their first visit, then work offline.
  // The Library loads living covers itself, so those stay precached.
  onDemandPages: [
    /\/src\/features\/(elements|experiments|notes-lab|sheet-lab|sync-lab)\//,
    /\/src\/features\/reader\/(debug|diagnostics)[/.]/,
    /\/src\/features\/settings\/DebugTools\.tsx$/,
    /\/src\/features\/background-activity\/ideas\//,
    /\/src\/features\/living-covers\/LivingCoversIdea\.tsx$/,
  ],
  // The Latin faces of the interface (DM Sans, Inter for figures, EB
  // Garamond for titles) and of the default reading font, Lora. Other
  // reading fonts and other scripts load when text first uses them.
  precacheFonts: /^assets\/(dm-sans|inter|eb-garamond|lora)-latin-\d+-/,
});

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
        // `precache` keeps the code and fonts every reader needs; the rest
        // comes from the `reader-assets` cache after its first use. Either way
        // a font comes from Cache Storage, never an HTTP revalidation. Every
        // browser that runs the service worker takes the woff2 source, so the
        // woff fallbacks Fontsource also emits stay out.
        globPatterns: ["**/*.{js,css,html,woff2}"],
        // A new version waits after it installs, keeping this version's files,
        // and takes over when the page posts SKIP_WAITING: at once by
        // default, at a safe moment with Debug -> Calm updates.
        skipWaiting: false,
        clientsClaim: true,
        manifestTransforms: [precache.manifestTransform],
        navigateFallbackDenylist: [/^\/api\//],
        globIgnores: [
          "**/assets/encode-*.js",
          "**/assets/webp_enc*.js",
          "**/assets/webp_enc*.wasm",
          // Install-time images: launch screens and store screenshots.
          "launch/**",
          "screenshots/**",
        ],
        runtimeCaching: [
          {
            // Built files outside the precache: on-demand pages, other fonts
            // and the WebP encoder. Names carry a content hash, so a cached
            // copy never goes stale.
            urlPattern: ({ sameOrigin, url }) =>
              sameOrigin &&
              /^\/assets\/.+\.(js|css|woff2|wasm)$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "reader-assets",
              expiration: { maxEntries: 400, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
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
