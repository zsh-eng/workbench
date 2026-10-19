import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The shared API trusts http://localhost:5186 in local development.
export default defineConfig({
  plugins: [react()],
  server: { host: "localhost", port: 5186, strictPort: true },
  preview: { host: "localhost", port: 5186, strictPort: true },
  build: { target: "es2022" },
});
