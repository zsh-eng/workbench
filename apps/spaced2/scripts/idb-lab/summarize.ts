/**
 * Medians and spread of `run.ts` output.
 *
 *   bun scripts/idb-lab/summarize.ts out.jsonl [--by label,browser]
 */
import { readFileSync } from "node:fs";

const [path] = process.argv.slice(2);
if (!path) {
  console.error("usage: summarize.ts <out.jsonl>");
  process.exit(64);
}

interface Line {
  label: string;
  browser: string;
  ms: number;
  puts: number;
  load: number;
  disk: number;
}

const groups = new Map<string, Line[]>();
for (const text of readFileSync(path, "utf8").trim().split("\n")) {
  const line = JSON.parse(text) as Line;
  const key = `${line.browser}\t${line.label}`;
  groups.set(key, [...(groups.get(key) ?? []), line]);
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = (sorted.length - 1) / 2;
  return (sorted[Math.floor(mid)]! + sorted[Math.ceil(mid)]!) / 2;
};

console.log(
  "| Browser | Run | n | Rows | Median ms | Range | µs/row | Disk MB | Load |",
);
console.log("| --- | --- | -: | -: | -: | --- | -: | -: | --- |");
for (const [key, lines] of groups) {
  const [browser, label] = key.split("\t");
  const times = lines.map((line) => line.ms);
  const loads = lines.map((line) => line.load);
  const puts = lines[0]!.puts;
  console.log(
    `| ${browser} | ${label} | ${lines.length} | ${puts.toLocaleString("en-US")} | ${Math.round(median(times)).toLocaleString("en-US")} | ${Math.round(Math.min(...times)).toLocaleString("en-US")}–${Math.round(Math.max(...times)).toLocaleString("en-US")} | ${Math.round((median(times) * 1000) / puts)} | ${(median(lines.map((line) => line.disk)) / 1e6).toFixed(1)} | ${Math.min(...loads).toFixed(1)}–${Math.max(...loads).toFixed(1)} |`,
  );
}
