import { appendFileSync, chmodSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { scopedFetch } from "./arctic";
import { buildSpaced, LEDGER } from "./spaced";
import {
  applyPlan,
  describePlan,
  parseChangeSet,
  planChangeSet,
  readSpaced,
  spacedPusher,
} from "./spaced-apply";
import { resolveImages, type LocalImage } from "./spaced-images";
import type { Store } from "./store";
import { pull } from "./sync";

/** Every request `wb spaced apply` makes: Spaced's scope, its image uploads and its pushes. */
const ALLOWED: [method: string, path: RegExp][] = [
  ["GET", /^\/api\/apps\/spaced\/sync\/v3\/state$/],
  ["PUT", /^\/api\/apps\/spaced\/files\/xxh64:[a-f0-9]{16}$/],
  ["POST", /^\/api\/apps\/spaced\/sync\/v3\/push$/],
];

/** Stores an image as the app does; the same bytes keep the same ID. */
async function upload(send: typeof fetch, origin: string, image: LocalImage) {
  const response = await send(`${origin}/api/apps/spaced/files/${image.id}`, {
    method: "PUT",
    body: image.bytes,
    headers: { "Content-Type": image.type },
  });
  const stored = response.ok ? ((await response.json()) as { id?: string }).id : undefined;
  if (stored !== image.id)
    throw Error(`could not upload ${image.path} (HTTP ${response.status})`);
}

export async function spacedApplyCommand(options: {
  store: Store;
  origin: string;
  token: string;
  directory: string;
  file: string;
  apply: boolean;
  json: boolean;
  /** Who wrote the change set, kept only in the local ledger. */
  model?: string;
  effort?: string;
}) {
  const { store, origin, token, directory, file, apply, json, model, effort } = options;
  // Local images become Spaced file URLs here, so the plan, the preview and
  // the undo file all hold the text that the cards will have.
  const local = resolveImages(parseChangeSet(readFileSync(file, "utf8")), dirname(resolve(file)), origin);
  const set = local.set;
  console.error("Syncing spaced…");
  await pull(store, origin, token, "spaced", []);
  const spaced = readSpaced(store.db);
  const plan = planChangeSet(set, spaced);
  plan.problems.push(...local.problems);
  // Only images that a change to be applied uses.
  const uploads = local.images.filter((image) => image.changes.some((index) => !plan.items[index]!.skip));
  const preview = {
    ...describePlan(plan),
    images: uploads.map(({ path, id, type, bytes }) => ({ path, id, type, bytes: bytes.length })),
  };
  if (!apply || plan.problems.length) {
    print({ ...preview, applied: false }, json);
    if (plan.problems.length) process.exitCode = 1;
    else if (!json) console.log("Dry run: nothing was written. Add --apply to push.");
    return;
  }
  const send = scopedFetch(origin, token, {
    allowed: ALLOWED,
    refusal: "wb spaced refused a request outside Spaced's sync",
    // A push is not repeated: a lost answer may hide a stored push.
    once: ["/api/apps/spaced/sync/v3/push"],
  });
  // Every image is stored before any card links to it.
  try {
    for (const image of uploads) await upload(send, origin, image);
  } catch (error) {
    const skipped = plan.items.filter((item) => item.skip).length;
    print({ ...preview, applied: 0, skipped, failed: plan.items.length - skipped, error: (error as Error).message }, json);
    process.exitCode = 1;
    return;
  }
  const push = await spacedPusher(origin, send, spaced.clock);
  const result = await applyPlan(plan, spaced, push);
  let undoFile: string | undefined;
  if (result.undo) {
    undoFile = `${file.replace(/\.json$/, "")}.undo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(undoFile, JSON.stringify(result.undo, null, 1));
  }
  if (result.storedKeys.length) {
    // Device-local provenance: Spaced keeps only the device ID per record.
    const ledger = join(directory, LEDGER);
    const entry = { at: new Date().toISOString(), file: basename(file), title: set.title ?? null,
      model: model ?? null, effort: effort ?? null, keys: result.storedKeys };
    appendFileSync(ledger, JSON.stringify(entry) + "\n", { mode: 0o600 });
    chmodSync(ledger, 0o600);
  }
  console.error("Syncing spaced…");
  await pull(store, origin, token, "spaced", []);
  buildSpaced(store.db, join(directory, "spaced.sqlite"));
  const summary = {
    ...preview,
    applied: result.applied,
    skipped: result.skipped,
    failed: result.failed,
    error: result.error,
    undoFile,
  };
  print(summary, json);
  if (result.error) process.exitCode = 1;
}

type Preview = ReturnType<typeof describePlan> & {
  images: { path: string; id: string; type: string; bytes: number }[];
};

function print(summary: Preview & Record<string, unknown>, json: boolean) {
  if (json) return console.log(JSON.stringify(summary));
  const lines = [summary.title ?? "Change set"];
  for (const [action, { apply, skip }] of Object.entries(summary.actions))
    lines.push(`  ${action.padEnd(10)} ${String(apply).padStart(5)}${skip ? `  (${skip} skipped)` : ""}`);
  for (const [reason, count] of Object.entries(summary.skipReasons))
    lines.push(`  skipped: ${reason} × ${count}`);
  if (summary.newDecks.length) lines.push(`  new decks: ${summary.newDecks.join(", ")}`);
  if (summary.images.length) {
    const kib = summary.images.reduce((total, image) => total + image.bytes, 0) / 1024;
    lines.push(`  images     ${String(summary.images.length).padStart(5)}  (${kib.toFixed(0)} KiB to upload)`);
  }
  for (const problem of summary.problems) lines.push(`  problem: ${problem}`);
  if (summary.applied !== false)
    lines.push(
      `Applied ${summary.applied}, skipped ${summary.skipped}, not applied ${summary.failed}.`,
      ...(summary.error ? [`Stopped: ${summary.error}`] : []),
      ...(summary.undoFile ? [`Undo: wb spaced apply ${summary.undoFile} --apply`] : []),
    );
  console.log(lines.join("\n"));
}
