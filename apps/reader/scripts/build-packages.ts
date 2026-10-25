/**
 * Builds the workspace packages that the Reader imports from `dist`. A
 * package whose `dist` is newer than its source and build config is
 * skipped. FORCE=1 builds them all.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES = ["text-highlighter", "local-sync"];
const INPUTS = ["src", "package.json", "tsconfig.json", "tsup.config.ts"];

function mtimes(path: string): number[] {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (!stat.isDirectory()) return [stat.mtimeMs];
  // A directory's own time changes when a file in it is deleted.
  return [
    stat.mtimeMs,
    ...readdirSync(path).flatMap((entry) => mtimes(join(path, entry))),
  ];
}

function isFresh(directory: string): boolean {
  const built = mtimes(join(directory, "dist"));
  if (!built.length) return false;
  const inputs = INPUTS.flatMap((input) => mtimes(join(directory, input)));
  return Math.min(...built) > Math.max(...inputs);
}

for (const name of PACKAGES) {
  const directory = fileURLToPath(
    new URL(`../../../packages/${name}/`, import.meta.url),
  );
  if (!process.env.FORCE && isFresh(directory)) continue;
  const { status } = spawnSync("bun", ["run", "build"], {
    cwd: directory,
    stdio: "inherit",
  });
  if (status !== 0) process.exit(status ?? 1);
}
