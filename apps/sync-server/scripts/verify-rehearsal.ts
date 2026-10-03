/** Local-only validation of a rehearsal through both applications' real codecs. */
import { Database } from "bun:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import xxhash from "xxhash-wasm";
import { syncRecordSchema, decodeSyncValue } from "@zsh-eng/local-sync";
import { READER_SYNC_TABLES } from "../../reader/src/lib/sync-v2/tables";
import { syncTables } from "../../spaced2/src/lib/sync/records";

const [directory] = Bun.argv.slice(2);
if (!directory)
  throw new Error(
    "Usage: bun --tsconfig-override apps/reader/tsconfig.app.json apps/sync-server/scripts/verify-rehearsal.ts <rehearsal-directory>",
  );
const db = new Database(join(directory, "shared.sqlite"), { readonly: true });
const counts: Record<string, number> = { reader: 0, spaced: 0 };
for (const row of db
  .query("SELECT * FROM sync_records ORDER BY server_seq")
  .iterate() as Iterable<Record<string, any>>) {
  const record = syncRecordSchema.parse({
    key: row.key,
    value: row.value,
    schemaVersion: row.schema_version,
    hlc: { wallTimeMs: row.hlc_wall_time_ms, counter: row.hlc_counter },
    deviceId: row.device_id,
    isDeleted: Boolean(row.is_deleted),
    serverSeq: row.server_seq,
  });
  const [table, id] = JSON.parse(record.key);
  const tables = row.namespace === "reader" ? READER_SYNC_TABLES : syncTables;
  const config = (tables as Record<string, any>)[table];
  if (!config || config.schemaVersion !== record.schemaVersion)
    throw new Error("Unsupported domain table or version");
  const decoded = config.decode
    ? config.decode(record.value)
    : decodeSyncValue<any>(record.value);
  if (decoded.id !== id || Boolean(decoded.isDeleted) !== record.isDeleted)
    throw new Error("Decoded identity mismatch");
  counts[row.namespace]++;
}
const files = JSON.parse(
  readFileSync(join(directory, "file-copy-manifest.json"), "utf8"),
);
const hasher = await xxhash();
for (const file of files) {
  const bytes = readFileSync(file.backupFile);
  const id = "xxh64:" + hasher.h64Raw(bytes).toString(16).padStart(16, "0");
  if (id !== file.fileId || bytes.length !== file.size)
    throw new Error("File content ID mismatch");
}
db.close();
const report = {
  domainRecordsDecoded: counts,
  fileContentIdsVerified: files.length,
};
writeFileSync(
  join(directory, "domain-verification.json"),
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(report));
