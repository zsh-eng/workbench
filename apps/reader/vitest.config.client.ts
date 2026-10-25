import { defineProject } from "vitest/config";
import path from "path";

export default defineProject({
  resolve: {
    // One React for workspace packages with a React peer (see vite.config.ts).
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
