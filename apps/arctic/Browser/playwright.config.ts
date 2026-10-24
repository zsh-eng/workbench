import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The real app against the local shared API, with a fresh database per run.
// E2E_PORT and E2E_API_PORT move both, so two worktrees can run at once.
const state = mkdtempSync(join(tmpdir(), "arctic-web-test-"));
const port = process.env.E2E_PORT ?? "5186";
const apiPort = process.env.E2E_API_PORT ?? "8792";
const ports = process.env.E2E_PORT
  ? `SHARED_APP_PORT=${port} SHARED_API_PORT=${apiPort} ${process.env.E2E_INSPECTOR_PORT ? `SHARED_INSPECTOR_PORT=${process.env.E2E_INSPECTOR_PORT} ` : ""}`
  : "";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `SHARED_APPS=arctic/Browser SHARED_PERSIST_TO=${state} ${ports}bun ../../../scripts/dev-shared.ts`,
    url: `http://localhost:${port}`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
