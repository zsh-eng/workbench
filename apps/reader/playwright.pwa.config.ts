import { defineConfig, devices } from "@playwright/test";
// Run after bun run build. This uses the production service worker and no API mocks.
export default defineConfig({
  testDir: "./test/e2e",
  outputDir: "./test-results/pwa",
  testMatch: "reader-pwa.spec.ts",
  timeout: 60_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5195",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // http.server queues only 5 connections and resets the rest, which the
    // service worker's precache burst exceeds while the page loads modules.
    command: `python3 -c "import functools, http.server as h; h.ThreadingHTTPServer.request_queue_size = 256; h.test(HandlerClass=functools.partial(h.SimpleHTTPRequestHandler, directory='dist/client'), ServerClass=h.ThreadingHTTPServer, port=5195, bind='127.0.0.1')"`,
    url: "http://127.0.0.1:5195",
    reuseExistingServer: false,
  },
});
