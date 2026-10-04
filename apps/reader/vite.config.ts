import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  cacheDir: process.env.VITE_SHARED_API_URL
    ? "node_modules/.vite-shared"
    : undefined,
  optimizeDeps: {
    exclude: ["@jsquash/webp"],
  },
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // App owns registration. Isolated debug frames must never register a worker.
      injectRegister: false,
      devOptions: {
        enabled: true,
      },
      workbox: {
        // Built-in document and pagination-worker fonts must be available from
        // CacheStorage on repeat launches, without an HTTP cache revalidation.
        globPatterns: ["**/*.{js,css,html,woff,woff2}"],
        // Explicit registration must retain the existing auto-update lifecycle.
        skipWaiting: true,
        clientsClaim: true,
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
    ...(command === "serve" && process.env.VITE_SHARED_API_URL
      ? []
      : [cloudflare()]),
  ],
  build: {
    outDir: "dist",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@server": path.resolve(__dirname, "./server"),
    },
  },
  server: {
    allowedHosts: ["fe-dev.zsheng.app", "pc.zsheng.app"],
  },
}));
