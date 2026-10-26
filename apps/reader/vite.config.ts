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
  // reading fonts and other scripts load when text first uses them. The sans
  // reading fonts stay out too: the saved one downloads once the Library has
  // painted, when the pagination worker warms with it, so it is offline
  // before a book needs it (src/features/reader/README.md, Reading fonts).
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
        globPatterns: [
          "**/*.{js,css,html,woff2}",
          // The installed app's own files: its web manifest and the icons
          // that browsers and the install sheet show. Other sizes stay out,
          // and so do the launch screens and store screenshots: iOS fetches
          // a launch screen from the network, never through this worker,
          // when Add to Home Screen is tapped, and keeps it with the icon.
          "{manifest.webmanifest,favicon.ico,apple-touch-icon-180x180.png,pwa-192x192.png,pwa-512x512.png}",
        ],
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
      // The icons come from `globPatterns`, through `precache`, so that
      // `sw-precache.json` counts them. The plugin's own icon entries skip it.
      includeManifestIcons: false,
      manifest: {
        // Chrome's identity for an install: the start URL it used before.
        id: "/",
        name: "Reader",
        short_name: "Reader",
        description:
          "An EPUB reader for your own books. Your library works offline, and highlights, notes and your place follow you across devices.",
        categories: ["books", "education", "productivity"],
        lang: "en",
        start_url: "/",
        display: "standalone",
        theme_color: "#ffffff",
        // Android's splash screen: the Library's light page colour, as on
        // the iOS launch screens (scripts/launch-screens.ts).
        background_color: "#ffffff",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
        ],
        // Chrome's richer install dialog. Public-domain books only; made
        // by scripts/pwa-screenshots.ts. Not precached.
        screenshots: [
          {
            src: "screenshots/library-narrow.jpg",
            sizes: "780x1688",
            type: "image/jpeg",
            form_factor: "narrow",
            label: "Your library, with the books you are reading first",
          },
          {
            src: "screenshots/reader-narrow.jpg",
            sizes: "780x1688",
            type: "image/jpeg",
            form_factor: "narrow",
            label: "A page of Alice's Adventures in Wonderland",
          },
          {
            src: "screenshots/library-wide.jpg",
            sizes: "1280x800",
            type: "image/jpeg",
            form_factor: "wide",
            label: "Your library on a computer",
          },
          {
            src: "screenshots/reader-wide.jpg",
            sizes: "1280x800",
            type: "image/jpeg",
            form_factor: "wide",
            label: "Two pages side by side",
          },
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
                {
                  // The Reader's loader, which the entry and the Library
                  // share. Out of the entry chunk for the same reason; the
                  // entry gives it the import() that names the Reader's file.
                  name: "screen-loader",
                  test: /\/src\/(lib\/prefetch|features\/reader\/load-reader)\.ts$/,
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
