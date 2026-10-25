import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import appConfig from "../../vite.config";

// Tests bring their own scenes; the developer's local scenes stay out.
process.env.READER_LIVING_COVERS_DIR = fileURLToPath(
  new URL("./living-covers-none", import.meta.url),
);

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
      server: { warmup: { clientFiles: ["./src/main.tsx"] } },
    },
  ),
);
