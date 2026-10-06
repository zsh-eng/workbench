// Starts the loopback data server and the Vite UI together.
import { join } from "node:path";

const cwd = join(import.meta.dir, "..");
const server = Bun.spawn([process.execPath, "--watch", "server/index.ts"], {
  cwd,
  env: { ...process.env, XMB_DIST: join(cwd, "no-dist-in-dev") },
  stdout: "inherit",
  stderr: "inherit",
});
const ui = Bun.spawn([process.execPath, "run", "dev:ui"], { cwd, stdout: "inherit", stderr: "inherit" });

let closing = false;
async function close(code: number) {
  if (closing) return;
  closing = true;
  server.kill("SIGTERM");
  ui.kill("SIGTERM");
  await Promise.all([server.exited, ui.exited]);
  process.exit(code);
}
process.on("SIGINT", () => void close(0));
process.on("SIGTERM", () => void close(0));
void server.exited.then((code) => close(code ?? 0));
void ui.exited.then((code) => close(code ?? 0));
