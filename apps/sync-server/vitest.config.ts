import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import path from "node:path";
import { createRequire } from "node:module";
const app = import.meta.dirname;
const vitest = path.dirname(
  createRequire(path.join(app, "package.json")).resolve("vitest/package.json"),
);
export default defineConfig(async () => ({
  root: path.resolve(app, "../.."),
  resolve: {
    // Keep the worker and test imports on the same workspace Vitest version.
    // An unrelated hoisted version can otherwise enter workerd's module graph.
    alias: [
      { find: /^vitest$/, replacement: path.join(vitest, "dist/index.js") },
      {
        find: /^vitest\/(worker|runtime|snapshot|runners|suite|environments)$/,
        replacement: `${vitest}/dist/$1.js`,
      },
    ],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: path.join(app, "wrangler.jsonc") },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(app, "migrations")),
        },
      },
    }),
  ],
  test: {
    include: ["apps/sync-server/test/**/*.test.ts"],
    setupFiles: [path.join(app, "test/setup.ts")],
  },
}));
