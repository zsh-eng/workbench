import type { Context } from "hono";
import { linkChangesProblem } from "@workbench/arctic-links";
import {
  MAX_SYNC_PUSH_BODY_BYTES,
  syncPushBodySchema,
} from "@zsh-eng/local-sync";
import type { AppEnv } from "./env";

/** The body, read once up to the push limit; undefined when it is larger. */
async function boundedText(c: Context<AppEnv>) {
  const declared = c.req.header("Content-Length");
  if (declared !== undefined && !(Number(declared) <= MAX_SYNC_PUSH_BODY_BYTES))
    return undefined;
  const reader = c.req.raw.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (
    let part = await reader?.read();
    part && !part.done;
    part = await reader!.read()
  ) {
    size += part.value.byteLength;
    if (size > MAX_SYNC_PUSH_BODY_BYTES) {
      await reader!.cancel();
      return undefined;
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  // The sync route reads the same body again, from this copy.
  c.req.raw = new Request(c.req.raw, { body: text });
  return text;
}

/**
 * Why a Workbench Backup credential's write to `arctic` is refused, or
 * undefined when it only saves links: new links in the phone's exact
 * records, or a link from History saved again as a field edit
 * (`linkChangesProblem` in @workbench/arctic-links). It runs before the sync
 * route and compares the changes with the stored records of the same
 * articles, so a value the phone cannot read never reaches it.
 */
export async function cliLinkPushProblem(c: Context<AppEnv>) {
  if (
    c.req.method !== "POST" ||
    decodeURIComponent(c.req.path) !== "/api/apps/arctic/sync/v3/push"
  )
    return "only a sync push can save links";
  const text = await boundedText(c);
  if (text === undefined) return "the push is too large";
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return "the push is not JSON";
  }
  const parsed = syncPushBodySchema.safeParse(body);
  if (!parsed.success) return "the push is not a sync push";
  const { changes } = parsed.data;
  const ids = new Set(changes.map((change) => change.key.split("/")[1] ?? ""));
  const keys = [...ids].flatMap((id) =>
    ["article", "library", "tags"].map((family) => `${family}/${id}`),
  );
  const stored = await c.env.DATABASE.prepare(
    "SELECT key,value,is_deleted FROM sync_records WHERE user_id=? AND namespace='arctic' AND key IN (SELECT value FROM json_each(?))",
  )
    .bind(c.get("user").id, JSON.stringify(keys))
    .all<{ key: string; value: string; is_deleted: number }>();
  return linkChangesProblem(
    changes,
    new Map(
      stored.results.map((row) => [
        row.key,
        { value: row.value, isDeleted: row.is_deleted !== 0 },
      ]),
    ),
  );
}
