import { join } from "node:path";
const cwd = join(import.meta.dir, "..");
const service = Bun.spawn([process.execPath, "server/index.ts"], {
  cwd,
  stdout: "inherit",
  stderr: "inherit",
});
const ui = Bun.spawn([process.execPath, "run", "dev:ui"], {
  cwd,
  stdout: "inherit",
  stderr: "inherit",
});
let closing = false;
async function close(code: number) {
  if (closing) return;
  closing = true;
  service.kill("SIGTERM");
  ui.kill("SIGTERM");
  await Promise.all([service.exited, ui.exited]);
  process.exit(code);
}
process.on("SIGINT", () => void close(0));
process.on("SIGTERM", () => void close(0));
void service.exited.then((code) => close(code));
void ui.exited.then((code) => close(code));
