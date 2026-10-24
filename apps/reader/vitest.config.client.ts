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
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@server": path.resolve(__dirname, "./server"),
    },
  },
  test: {
    name: "client",
    environment: "happy-dom",
    setupFiles: ["./test/setup/indexeddb.ts"],
  },
});
