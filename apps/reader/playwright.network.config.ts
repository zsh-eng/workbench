import { defineConfig, devices } from "@playwright/test";

// Build with VITE_BETTER_AUTH_URL=http://127.0.0.1:5196
// VITE_SHARED_API_URL=http://127.0.0.1:5196 bun run build first.
// Run: bunx playwright test --config playwright.network.config.ts
// Faults occur at the server, below the production SW.
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "startup-network.spec.ts",
  outputDir: "test-results/network",
  workers: 1,
  timeout: 60_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5196",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "bun scripts/network-lab.ts",
    url: "http://127.0.0.1:5196",
    reuseExistingServer: false,
  },
});
