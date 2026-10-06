import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = { target: "http://127.0.0.1:5296", changeOrigin: true };

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5295,
    strictPort: true,
    proxy: { "/api": api, "/media": api, "/derived": api },
  },
  build: { target: "es2022", sourcemap: false },
});
