import { defineConfig } from "@playwright/test";
import { LIBRARY, PORT } from "./tests/fixture";

// Runs the production build and the real loopback server against a synthetic fixture.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    viewport: { width: 1280, height: 860 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun server/index.ts",
    url: `http://127.0.0.1:${PORT}`,
    env: { XMB_LIBRARY: LIBRARY, XMB_PORT: String(PORT) },
    reuseExistingServer: false,
  },
});
