import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
const app = import.meta.dirname;
export default defineConfig(async () => ({
  root: path.resolve(app, "../.."),
  resolve: {
    alias: {
      "vitest/worker": fileURLToPath(import.meta.resolve("vitest/worker")),
    },
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
