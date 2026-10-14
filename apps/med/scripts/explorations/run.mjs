// Runs the exploration scenes on the demo world.
//
//   node scripts/explorations/run.mjs                  screenshots of every scene
//   node scripts/explorations/run.mjs --only 03,05     some scenes
//   node scripts/explorations/run.mjs --record         a 2x video (headed Chromium)
//   options: --port 6420  --out <dir>  --light  --keep (leave the world)
//
// Build Med first (`bun run build`). A scene is scenes/NN-name.mjs with
// `export const meta = { title, summary }` and a default async function that
// takes the stage (see stage.mjs). Each scene starts from the thread list.
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildWorld } from "./world.mjs";
import { listScenes, openStage } from "./stage.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const record = args.includes("--record");
const only = option("only", "").split(",").filter(Boolean);
const port = Number(option("port", "6420"));
const out = resolve(option("out", join(tmpdir(), "med-explorations")));
const scenes = join(import.meta.dirname, "scenes");

const world = await buildWorld(join(out, "world"));
const stage = await openStage({
  world,
  port,
  out,
  record,
  theme: args.includes("--light") ? "light" : "dark",
});
let failed = false;
try {
  for (const file of await listScenes(scenes)) {
    if (only.length && !only.some((prefix) => file.startsWith(prefix))) continue;
    const scene = await import(join(scenes, file));
    const started = Date.now();
    console.log(`scene ${file}: ${scene.meta?.title ?? ""}`);
    await scene.default(stage);
    console.log(`  done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
} catch (error) {
  failed = true;
  console.error(error);
  await stage.page.screenshot({ path: join(out, "failure.png") }).catch(() => {});
} finally {
  const result = await stage.close();
  console.log(JSON.stringify({ out, frames: result.frames, pageErrors: result.errors }));
  if (failed) console.error(result.hostLog.slice(-3000));
}
process.exit(failed ? 1 : 0);
