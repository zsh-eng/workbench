import { defineConfig } from "tsup";
export default defineConfig({
  entry: [
    "src/index.ts",
    "src/dexie/index.ts",
    "src/hono/index.ts",
    "src/react/index.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["zod", "dexie", "hono", "@hono/zod-validator", "react"],
});
