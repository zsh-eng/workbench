/**
 * Builds the workspace packages that apps import from `dist`. A package is
 * skipped while its build stamp is newer than every source and config file.
 * FORCE=1 builds them all.
 *
 * The stamp is written only after a build succeeds, with the time at which
 * that build started. A failed or interrupted build leaves no stamp, and a
 * file saved during a build is newer than the stamp, so each rebuilds next
 * time. `tsup` cleans `dist`, so a build by hand removes the stamp too.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES = ["text-highlighter", "local-sync"];
const INPUTS = ["src", "package.json", "tsconfig.json", "tsup.config.ts"];
const STAMP = "dist/build-stamp";

function newest(path: string): number {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  // A directory's own time changes when a file in it is added or deleted.
  return Math.max(
    stat.mtimeMs,
    ...readdirSync(path).map((entry) => newest(join(path, entry))),
  );
}

function isFresh(directory: string): boolean {
  const stamp = join(directory, STAMP);
  if (!existsSync(stamp)) return false;
  const inputs = INPUTS.map((input) => newest(join(directory, input)));
  return statSync(stamp).mtimeMs > Math.max(...inputs);
}

for (const name of PACKAGES) {
  const directory = fileURLToPath(
    new URL(`../packages/${name}/`, import.meta.url),
  );
  if (!process.env.FORCE && isFresh(directory)) continue;
  const stamp = join(directory, STAMP);
  rmSync(stamp, { force: true });
  const started = Date.now() / 1000;
  const { status } = spawnSync("bun", ["run", "build"], {
    cwd: directory,
    stdio: "inherit",
  });
  if (status !== 0) process.exit(status ?? 1);
  writeFileSync(stamp, "");
  utimesSync(stamp, started, started);
}
