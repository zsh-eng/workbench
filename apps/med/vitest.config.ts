import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";
import { pierreKeepAlive } from "./tools/pierre-keep-alive.ts";
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/browser/**", "tests/host/**", "tests/integration/**"],
          environment: "node",
          testTimeout: 30000,
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/host/**/*.test.ts", "tests/integration/**/*.test.ts"],
          environment: "node",
          // As in CI, whether or not Claude Code runs the tests.
          env: { CLAUDECODE: "" },
          testTimeout: 30000,
        },
      },
      {
        // Same worker-safe decoders as vite.config.ts, so Markdown workers run.
        resolve: {
          alias: Object.fromEntries(
            ["decode-named-character-reference"].map((name) => [
              name,
              createRequire(import.meta.url).resolve(name),
            ]),
          ),
        },
        plugins: [pierreKeepAlive(), stylex.vite({ useCSSLayers: true }), react()],
        optimizeDeps: {
          exclude: ["@pierre/diffs"],
          include: [
            "@pierre/diffs > lru_map",
            "@pierre/diffs > @pierre/patches",
            "@base-ui/react/combobox",
            "@base-ui/react/popover",
            "@base-ui/react/tabs",
            "@base-ui/react/tooltip",
            "@pierre/trees",
            // The Markdown worker's; the scan does not follow a worker's imports.
            "katex",
            "rehype-stringify",
            "unified",
          ],
        },
        test: {
          name: "browser",
          include: ["tests/browser/**/*.test.ts", "tests/browser/**/*.test.tsx"],
          // The files of a worker share its page: the app's modules, workers,
          // and highlighter load once. setup.ts gives each file a fresh start.
          isolate: false,
          setupFiles: ["tests/browser/setup.ts"],
          // While every worker's page renders at once, a frame can take a
          // while; a poll that passes returns as soon as it does.
          expect: { poll: { timeout: 3000 } },
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
            headless: true,
          },
        },
      },
    ],
  },
});
