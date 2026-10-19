import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The real app against the local shared API, with a fresh database per run.
const state = mkdtempSync(join(tmpdir(), "arctic-web-test-"));
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:5186",
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `SHARED_APPS=arctic/Browser SHARED_PERSIST_TO=${state} bun ../../../scripts/dev-shared.ts`,
    url: "http://localhost:5186",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
