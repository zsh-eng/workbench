/**
 * What a Chrome trace of a restore spent in IndexedDB. Reads the trace line
 * by line, because a long one does not fit in a JSON.parse.
 *
 *   bun scripts/idb-lab/trace.ts run.json
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const [path] = process.argv.slice(2);
if (!path) {
  console.error("usage: trace.ts <trace.json>");
  process.exit(64);
}

interface Event {
  name: string;
  cat?: string;
  ph: string;
  pid: number;
  tid: number;
  ts: number;
  dur?: number;
  args?: Record<string, unknown>;
}

const threads = new Map<string, string>();
const totals = new Map<string, { n: number; ms: number }>();
const puts: { ts: number; dur: number }[] = [];
const compactions: { ts: number; dur: number }[] = [];
const WANTED = /IndexedDB|env_chromium|"thread_name"/;

for await (const raw of createInterface({ input: createReadStream(path) })) {
  if (!WANTED.test(raw)) continue;
  const text = raw
    .trim()
    .replace(/^\{"traceEvents":\[/, "")
    .replace(/,$/, "")
    .replace(/\]\}$/, "");
  if (!text.startsWith("{")) continue;
  let event: Event;
  try {
    event = JSON.parse(text) as Event;
  } catch {
    continue;
  }
  if (event.name === "thread_name") {
    threads.set(`${event.pid}:${event.tid}`, String(event.args?.name ?? "?"));
    continue;
  }
  if (event.ph !== "X") continue;
  const dur = (event.dur ?? 0) / 1000;
  if (JSON.stringify(event.args ?? {}).includes("env_chromium")) {
    if (event.name === "ThreadPool_RunTask")
      compactions.push({ ts: event.ts, dur });
    continue;
  }
  if (event.cat !== "IndexedDB") continue;
  const thread = threads.get(`${event.pid}:${event.tid}`) ?? "?";
  const key = `${thread.replace(/\d+$/, "")}\t${event.name}`;
  const total = totals.get(key) ?? { n: 0, ms: 0 };
  total.n++;
  total.ms += dur;
  totals.set(key, total);
  if (event.name === "BackingStore::PutRecord")
    puts.push({ ts: event.ts, dur });
}

console.log("Thread\tEvent\tCount\tms");
for (const [key, { n, ms }] of [...totals].sort((a, b) => b[1].ms - a[1].ms))
  if (ms >= 1) console.log(`${key}\t${n}\t${Math.round(ms)}`);

const slow = puts.filter((put) => put.dur > 1);
const sum = (items: { dur: number }[]) =>
  items.reduce((total, item) => total + item.dur, 0);
console.log(
  `puts ${puts.length}: ${Math.round(sum(puts))} ms; over 1 ms: ${slow.length}, ${Math.round(sum(slow))} ms; the rest ${Math.round(sum(puts) - sum(slow))} ms`,
);
console.log(
  `LevelDB background tasks ${compactions.length}: ${Math.round(sum(compactions))} ms`,
);
const buckets = new Map<number, number>();
for (const { dur } of slow) {
  const bucket = Math.round(dur * 2) / 2;
  buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
}
console.log(
  "slow puts by ms:",
  [...buckets]
    .sort((a, b) => a[0] - b[0])
    .slice(0, 16)
    .map(([ms, n]) => `${ms}:${n}`)
    .join(" "),
);
