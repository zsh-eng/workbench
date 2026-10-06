/** Summarize timings without including snapshot contents. */
import type { BenchmarkResult } from "./types";
const input = process.argv[2] ?? "cutover.local/sync-benchmark-results.json";
const { results }: { results: BenchmarkResult[] } = await Bun.file(input).json();
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
};
for (const delay of [...new Set(results.map((r) => r.delay))]) {
  for (const mode of [...new Set(results.map((r) => r.mode))]) {
    const runs = results.filter(
      (r) => r.delay === delay && r.mode === mode,
    );
    if (!runs.length) continue;
    if (runs.some((r) => !r.verified)) throw new Error("Unverified run");
    console.log(
      JSON.stringify({
        mode,
        delay,
        runs: runs.length,
        medianSeconds: median(runs.map((r) => r.totalMs)) / 1000,
        rangeSeconds: [
          Math.min(...runs.map((r) => r.totalMs)) / 1000,
          Math.max(...runs.map((r) => r.totalMs)) / 1000,
        ],
        medianPrepareSeconds: median(runs.map((r) => r.prepareMs)) / 1000,
        medianWriteAwaitSeconds: median(runs.map((r) => r.writeMs)) / 1000,
        writes: runs.map((r) => r.writes),
        requests: runs.map((r) => r.requests),
        maxPrepareMs: Math.max(...runs.map((r) => r.maxPrepareMs ?? 0)),
        maxWriteAwaitMs: Math.max(...runs.map((r) => r.maxWriteMs ?? 0)),
        maxQueueJsonBytes: Math.max(
          ...runs.map((r) => r.peakQueueJsonBytes),
        ),
      }),
    );
  }
}
export {};
