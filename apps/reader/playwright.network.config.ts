import { defineConfig, devices } from "@playwright/test";

// Build with VITE_BETTER_AUTH_URL=http://127.0.0.1:5196
// VITE_SHARED_API_URL=http://127.0.0.1:5196 bun run build first.
// Run: bunx playwright test --config playwright.network.config.ts
// Faults occur at the server, below the production SW. E2E_PORT moves the
// lab; build with that port in both URLs.
const port = Number(process.env.E2E_PORT ?? 5196);
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "startup-network.spec.ts",
  outputDir: "test-results/network",
  workers: 1,
  timeout: 60_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}`,
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `NETWORK_LAB_PORT=${port} bun scripts/network-lab.ts`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
