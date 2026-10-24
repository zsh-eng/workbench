import { defineProject } from "vitest/config";
import path from "path";

export default defineProject({
  // Let tests mock registration callbacks without starting a service worker.
  plugins: [
    {
      name: "test-pwa-register",
      resolveId(id) {
        if (id === "virtual:pwa-register/react") return id;
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@server": path.resolve(__dirname, "./server"),
    },
    // Workspace packages link their React peer from the workspace root,
    // which can be another version. One copy keeps their hooks working.
    dedupe: ["react", "react-dom"],
  },
  test: {
    name: "client",
    environment: "happy-dom",
    setupFiles: ["./test/setup/indexeddb.ts"],
  },
});
