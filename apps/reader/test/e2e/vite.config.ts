import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import appConfig from "../../vite.config";

// Tests bring their own scenes; the developer's local scenes stay out.
process.env.READER_LIVING_COVERS_DIR = fileURLToPath(
  new URL("./living-covers-none", import.meta.url),
);

// Names the checkout that this server runs from, and the files read only at
// its start that changed since. The global setup refuses a reused server
// from another worktree or app, or one that needs a restart.
const started = Date.now();
const marker: Plugin = {
  name: "reader-e2e-marker",
  configureServer(server) {
    server.middlewares.use("/__e2e", (_request, response) => {
      const { root, configFileDependencies } = server.config;
      const changed = [
        ...configFileDependencies,
        ...["../../bun.lock", ".dev.vars", "wrangler.jsonc"].map((file) =>
          resolve(root, file),
        ),
      ].filter((file) => existsSync(file) && statSync(file).mtimeMs > started);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ root, changed }));
    });
  },
};

// Browser tests must not share optimized modules with the user's dev server.
export default defineConfig(async (env) =>
  mergeConfig(
    await (typeof appConfig === "function" ? appConfig(env) : appConfig),
    {
      cacheDir: "node_modules/.vite-e2e",
      // React's transform adds these imports after Vite's dependency scan.
      optimizeDeps: {
        include: [
          "react/compiler-runtime",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
        ],
      },
      server: {
        warmup: { clientFiles: ["./src/main.tsx"] },
        // An edit still reaches the next page load. Without HMR, a warm
        // server keeps module URLs free of `?t=` stamps, so a test's
        // `import("/src/…")` gets the app's own module, and no page reloads
        // in the middle of a test.
        hmr: false,
      },
      plugins: [marker],
    },
  ),
);
