/** Verify the imported Worker bindings, not the input files alone. Local bindings only. */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { getPlatformProxy } from "wrangler";
import type { Bindings } from "../src/env";

const [planFile, configFile, persistTo] = Bun.argv.slice(2);
if (!planFile || !configFile || !persistTo)
  throw new Error(
    "Usage: bun verify-local-import.ts <import-plan.json> <config.json> <persist-to>",
  );
const plan = JSON.parse(readFileSync(planFile, "utf8"));
const source = new Database(join(plan.rehearsal, "shared.sqlite"), {
  readonly: true,
});
const proxy = await getPlatformProxy<Bindings>({
  configPath: resolve(configFile),
  remoteBindings: false,
  persist: { path: join(resolve(persistTo), "v3") },
});
const counts: Record<string, number> = {};
try {
  for (const table of [
    "user",
    "account",
    "sync_streams",
    "sync_records",
    "file_storage",
    "session",
    "verification",
    "client_devices",
  ]) {
    const expected = source
      .query(`SELECT * FROM "${table}" ORDER BY rowid`)
      .all() as Record<string, unknown>[];
    const columns = expected.length ? Object.keys(expected[0]).sort() : [];
    const total = await proxy.env.DATABASE.prepare(
      `SELECT count(*) AS n FROM "${table}"`,
    ).first<number>("n");
    if (total !== expected.length)
      throw new Error(`${table}: row count differs`);
    for (let offset = 0; offset < expected.length; offset += 1000) {
      const result = await proxy.env.DATABASE.prepare(
        `SELECT * FROM "${table}" ORDER BY rowid LIMIT 1000 OFFSET ?`,
      )
        .bind(offset)
        .all();
      const actual = result.results.map((row) =>
        columns.map((key) => row[key]),
      );
      const wanted = expected
        .slice(offset, offset + 1000)
        .map((row) => columns.map((key) => row[key]));
      if (JSON.stringify(actual) !== JSON.stringify(wanted))
        throw new Error(`${table}: imported row differs`);
    }
    counts[table] = expected.length;
  }
  for (const file of plan.files) {
    const object = await proxy.env.FILES.get(file.targetKey);
    if (!object || object.size !== file.size)
      throw new Error("Imported object missing or wrong size");
    const digest = createHash("sha256")
      .update(new Uint8Array(await object.arrayBuffer()))
      .digest("hex");
    if (digest !== file.sha256)
      throw new Error("Imported object checksum differs");
  }
  const report = {
    counts,
    filesVerified: plan.files.length,
    allRowsCompared: true,
    allObjectHashesCompared: true,
  };
  writeFileSync(
    join(plan.rehearsal, "local-worker-verification.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
} finally {
  source.close();
  await proxy.dispose();
}
