import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createApp } from "./app.ts";

const appDir = resolve(import.meta.dir, "..");
const port = Number(process.env.XMB_PORT || 5296);
const libraryDir = resolve(process.env.XMB_LIBRARY || join(appDir, "library.local"));
const distDir = resolve(process.env.XMB_DIST || join(appDir, "dist"));

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 120,
  maxRequestBodySize: 64 * 1024,
  fetch: createApp({ libraryDir, distDir: existsSync(distDir) ? distDir : null, port }),
});
console.log(`Moodboard: ${server.url} (library ${libraryDir})`);

const close = () => {
  server.stop(true);
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
