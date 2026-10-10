// Builds Med's live demo (apps/med/src/web/demo.ts) into a folder: the web
// app with relative asset paths. The site serves it at /demo/, beside
// public/demo/recording.json, which `bun run screenshots` records.
//
//   bun run demo    # into .demo/demo, for `bun run dev`
import { join } from "node:path";

const med = join(import.meta.dir, "../../med");

export function buildDemo(out: string) {
  const result = Bun.spawnSync(
    [
      "bun",
      "x",
      "vite",
      "build",
      "--config",
      "vite.demo.config.ts",
      "--logLevel",
      "warn",
    ],
    {
      cwd: med,
      env: { ...process.env, MED_DEMO_OUT: out },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if (result.exitCode !== 0) throw new Error("The Med demo did not build.");
}

if (import.meta.main) buildDemo(join(import.meta.dir, "../.demo/demo"));
