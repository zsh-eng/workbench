/** Writes the lab's synthetic rows as TSV for replay.cc: store, type, timestamp, id, JSON. */
import { decodeSyncKey } from "@zsh-eng/local-sync";
import { writeFileSync } from "node:fs";
import { labChanges } from "../../restore-lab";

const [out] = process.argv.slice(2);
if (!out) throw new Error("usage: export-rows.ts <rows.tsv>");
const rows = new Map<string, string>();
for (const change of labChanges("large", Date.UTC(2026, 9, 29))) {
  const [table] = decodeSyncKey(change.key);
  const row = JSON.parse(change.value) as {
    id: string;
    type: string;
    timestamp: number;
  };
  rows.delete(change.key);
  rows.set(
    change.key,
    [
      table === "operations" ? 1 : 2,
      row.type,
      row.timestamp,
      row.id,
      change.value,
    ].join("\t"),
  );
}
writeFileSync(out, [...rows.values()].join("\n") + "\n");
console.log(`${rows.size} rows`);
