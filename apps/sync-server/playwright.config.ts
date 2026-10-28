import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  retries: 0,
  timeout: 90_000,
  use: {
    actionTimeout: 15_000,
    headless: true,
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "bun run --cwd ../.. dev:shared",
    // SHARED_API_PORT moves the stack (scripts/dev-shared.ts).
    url: `http://localhost:${process.env.SHARED_API_PORT ?? "8792"}/health`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
