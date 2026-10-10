import { createRequire } from "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";
import { pierreHighlighter } from "./tools/pierre-highlighter.ts";
import { pierreKeepAlive } from "./tools/pierre-keep-alive.ts";

export default defineConfig({
  // The browser export uses document.createElement; workers need the table decoder.
  resolve: {
    alias: {
      "decode-named-character-reference": createRequire(import.meta.url).resolve(
        "decode-named-character-reference",
      ),
      "hast-util-from-html-isomorphic": createRequire(import.meta.url).resolve(
        "hast-util-from-html-isomorphic",
      ),
    },
  },
  plugins: [
    pierreHighlighter(),
    pierreKeepAlive(),
    // StyleX adds its rules to the app's own stylesheet: index.html's, or
    // main's in the demo, which imports main after it sets up. Without this
    // it picks the first CSS file, which can be a lazy route's.
    stylex.vite({
      useCSSLayers: true,
      cssInjectionTarget: (file) => /(^|\/)(index|main)-[\w-]{8,}\.css$/.test(file),
    }),
    react(),
  ],
  optimizeDeps: {
    exclude: ["@pierre/diffs"],
    include: [
      "lru_map",
      "@base-ui/react/combobox",
      "@base-ui/react/popover",
      "@base-ui/react/tabs",
      "@pierre/trees",
    ],
  },
  worker: { format: "es", plugins: () => [pierreHighlighter()] },
  build: { outDir: "dist/web", target: "es2022", sourcemap: true },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4174",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (request) => request.setHeader("origin", "http://127.0.0.1:4174"));
        },
      },
    },
  },
});
