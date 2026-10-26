import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The shared API trusts http://localhost:5186 in local development.
export default defineConfig({
  plugins: [
    react(),
    {
      // Names the checkout that the dev server runs from. The e2e global
      // setup refuses a reused server from another worktree or app.
      name: "e2e-marker",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use("/__e2e", (_request, response) => {
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ root: server.config.root }));
        });
      },
    },
  ],
  server: { host: "localhost", port: 5186, strictPort: true },
  preview: { host: "localhost", port: 5186, strictPort: true },
  build: { target: "es2022" },
  // Workspace packages with a React peer (local-sync/react) use this app's React.
  resolve: { dedupe: ["react", "react-dom"] },
});
