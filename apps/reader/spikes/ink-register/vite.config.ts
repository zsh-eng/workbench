import path from "path";
import { defineConfig } from "vite";

// Standalone dev server for the ink-register spike. It serves only this
// folder and imports the pagination engine from the Reader's source, without
// the Reader's plugins, worker or service worker.
//
//   cd apps/reader && bunx vite --config spikes/ink-register/vite.config.ts
const readerRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  root: __dirname,
  cacheDir: path.join(readerRoot, "node_modules/.vite-ink-register"),
  server: {
    host: "127.0.0.1",
    port: Number(process.env.SPIKE_PORT ?? 5342),
    strictPort: true,
    fs: { allow: [readerRoot, path.resolve(readerRoot, "../..")] },
  },
});
