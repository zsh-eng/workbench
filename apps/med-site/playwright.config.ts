import { defineConfig } from "@playwright/test";

const port = 4322;

export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: "chromium" },
  webServer: {
    command: `bun scripts/dev.ts --dist --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
