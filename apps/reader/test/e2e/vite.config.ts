import { defineConfig, mergeConfig } from "vite";
import appConfig from "../../vite.config";

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
