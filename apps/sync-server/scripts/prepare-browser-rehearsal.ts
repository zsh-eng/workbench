/** Add a disposable credential only to the isolated local target, after import verification. */
import { Database } from "bun:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getPlatformProxy } from "wrangler";
import { hashPassword } from "better-auth/crypto";
import type { Bindings } from "../src/env";
const [rehearsal, config, persistTo] = Bun.argv.slice(2);
if (!rehearsal || !config || !persistTo)
  throw new Error("Provide rehearsal, local config, persist-to");
JSON.parse(
  readFileSync(join(rehearsal, "local-worker-verification.json"), "utf8"),
);
const db = new Database(join(rehearsal, "shared.sqlite"), { readonly: true });
const owner = db
  .query("SELECT user_id FROM sync_records WHERE namespace='reader' LIMIT 1")
  .get() as { user_id: string };
const user = db
  .query("SELECT email FROM user WHERE id=?")
  .get(owner.user_id) as { email: string };
const counts: Record<string, Record<string, number>> = {
  reader: {},
  spaced: {},
};
for (const row of db
  .query("SELECT namespace,key FROM sync_records WHERE user_id=?")
  .all(owner.user_id) as { namespace: string; key: string }[]) {
  const table = JSON.parse(row.key)[0];
  counts[row.namespace][table] = (counts[row.namespace][table] ?? 0) + 1;
}
const book = db
  .query(
    "SELECT value FROM sync_records WHERE user_id=? AND namespace='reader' AND json_extract(key,'$[0]')='books' AND is_deleted=0 LIMIT 1",
  )
  .get(owner.user_id) as { value: string };
const files = JSON.parse(
  readFileSync(join(rehearsal, "file-copy-manifest.json"), "utf8"),
);
const image = files.find(
  (row: any) =>
    row.namespace === "spaced" &&
    row.userId === owner.user_id &&
    row.mediaType.startsWith("image/") &&
    row.deletedAt === null,
);
const password = crypto.randomUUID() + crypto.randomUUID();
const proxy = await getPlatformProxy<Bindings>({
  configPath: resolve(config),
  remoteBindings: false,
  persist: { path: join(resolve(persistTo), "v3") },
});
try {
  const now = Date.now();
  await proxy.env.DATABASE.prepare(
    "INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(
      "local-browser-rehearsal-credential",
      owner.user_id,
      "credential",
      owner.user_id,
      await hashPassword(password),
      now,
      now,
    )
    .run();
  const fixture = {
    email: user.email,
    password,
    userId: owner.user_id,
    counts,
    bookId: JSON.parse(book.value).id,
    image: { fileId: image.fileId, size: image.size, sha256: image.sha256 },
  };
  writeFileSync(
    join(rehearsal, "browser-fixture.json"),
    JSON.stringify(fixture),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({ browserFixturePrepared: true, expectedRows: counts }),
  );
} finally {
  db.close();
  await proxy.dispose();
}
