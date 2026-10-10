import { defineConfig, devices } from "@playwright/test";

/* Each worktree can run its own suite: E2E_PORT=5192 bun run test:e2e. */
const port = Number(process.env.E2E_PORT ?? 5190);

/**
 * Playwright configuration for E2E browser tests.
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./test/e2e",
  testIgnore: ["reader-pwa.spec.ts", "startup-network.spec.ts"],

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Reuse prepared data and limit competing Reader workers. */
  workers: process.env.CI ? 1 : 2,

  /* Reporter to use */
  reporter: "html",

  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL: `http://127.0.0.1:${port}`,

    /* Keep API mocks in control; PWA behavior needs a separate test. */
    serviceWorkers: "block",

    /* Keep evidence from the first failure, including local runs without retries */
    trace: "retain-on-failure",

    /* Take screenshot on failure */
    screenshot: "only-on-failure",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: `bun run dev --config test/e2e/vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
});
