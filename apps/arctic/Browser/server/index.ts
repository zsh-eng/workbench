import { join } from "node:path";
import { homedir } from "node:os";
import { DownloadService, createHandler } from "./service";
const port = Number(process.env.ARCTIC_SERVICE_PORT || 5187);
const origins = [
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
  "http://127.0.0.1:5186",
  "http://localhost:5186",
];
const service = new DownloadService(
  process.env.ARCTIC_CACHE_DIR ||
    join(homedir(), ".cache", "arctic-browser", "articles"),
);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  maxRequestBodySize: 16384,
  idleTimeout: 120,
  fetch: createHandler(service, origins),
});
console.log(`Arctic downloads: ${server.url}`);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  server.stop(true);
  await service.close();
  process.exit(0);
};
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
