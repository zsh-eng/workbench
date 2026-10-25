import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The real app against the local shared API, with a fresh database per run.
// E2E_PORT, E2E_PREVIEW_PORT, E2E_API_PORT and E2E_INSPECTOR_PORT move the
// servers, so two worktrees can run at once.
const state = mkdtempSync(join(tmpdir(), "arctic-web-test-"));
const port = process.env.E2E_PORT ?? "5186";
const previewPort = process.env.E2E_PREVIEW_PORT ?? "5187";
const apiPort = process.env.E2E_API_PORT ?? "8792";
const inspector = process.env.E2E_INSPECTOR_PORT
  ? `SHARED_INSPECTOR_PORT=${process.env.E2E_INSPECTOR_PORT} `
  : "";
const preview = `http://localhost:${previewPort}`;

export default defineConfig({
  testDir: "./tests",
  // Each test signs up its own account, so tests run in parallel.
  fullyParallel: true,
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "dev", testIgnore: /offline\.spec\.ts$/ },
    // Only a production build registers the service worker.
    {
      name: "production",
      testMatch: /offline\.spec\.ts$/,
      use: { baseURL: preview },
    },
  ],
  // Playwright starts these in order: the stack builds local-sync before the
  // production build needs it.
  webServer: [
    {
      command: `SHARED_APPS=arctic/Browser SHARED_PERSIST_TO=${state} SHARED_APP_PORT=${port} SHARED_API_PORT=${apiPort} SHARED_EXTRA_ORIGINS=${preview} ${inspector}bun ../../../scripts/dev-shared.ts`,
      url: `http://localhost:${port}`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `VITE_SHARED_API_URL=http://localhost:${apiPort} bun x --no-install vite build --outDir ${state}/dist --logLevel warn && bun x --no-install vite preview --outDir ${state}/dist --port ${previewPort} --strictPort`,
      url: preview,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
