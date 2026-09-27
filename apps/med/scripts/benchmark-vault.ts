/** Metadata benchmark. Accept only an external copy with an explicit copy manifest. */
import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import { mkdir, readFile, writeFile, unlink, stat, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { VaultIndex } from "../src/host/vault/index";
const exec = promisify(execFile);
const { values } = parseArgs({
  options: { copy: { type: "string" }, output: { type: "string" }, sample: { type: "string" } },
});
if (!values.copy || !values.output)
  throw new Error("Use --copy <external-vault-copy> --output <external-report.json>");
const root = await realpath(values.copy),
  output = resolve(values.output);
const manifest = JSON.parse(await readFile(join(dirname(root), "copy-manifest.json"), "utf8"));
if (manifest.vault !== root)
  throw new Error("Expected a benchmark copy with a matching copy-manifest.json beside it.");
for (const path of [root, dirname(output)]) {
  try {
    await exec("git", ["-C", path, "rev-parse", "--show-toplevel"]);
    throw new Error("Benchmark data must be outside Git repositories.");
  } catch (error) {
    if (!(error as { code?: unknown }).code) throw error;
  }
}
if (values.sample) {
  const database = join(dirname(output), `index-${values.sample}.sqlite`);
  let index = await VaultIndex.open(root, database);
  const events: { name: string; ph: string; ts: number; dur: number; pid: number; tid: number }[] =
    [];
  const initial = await index.refresh((name, start, end) =>
    events.push({ name, ph: "X", ts: start * 1000, dur: (end - start) * 1000, pid: 1, tid: 1 }),
  );
  await writeFile(
    join(dirname(output), `trace-${values.sample}.json`),
    JSON.stringify({ traceEvents: events }),
  );
  const warm = await index.refresh();
  index.close();
  const start = performance.now();
  index = await VaultIndex.open(root, database);
  const reopened = await index.refresh(),
    reopenMs = performance.now() - start;
  const targetPaths = index.targets(100),
    queryMs: number[] = [];
  let backlinkRows = 0;
  for (let i = 0; i < 10; i++)
    for (const { target } of targetPaths) {
      const t = performance.now();
      const rows = index.backlinks(target);
      queryMs.push(performance.now() - t);
      backlinkRows += rows.length;
    }
  const fixture = join(root, "MedBenchmarkFixture");
  await mkdir(fixture);
  try {
    await writeFile(join(fixture, "Target.md"), "# Benchmark target\n");
    await writeFile(join(fixture, "Source.md"), "# Benchmark source\n");
    await index.refresh();
    await writeFile(
      join(fixture, "Source.md"),
      "# Benchmark source\n[[MedBenchmarkFixture/Target]]\n",
    );
    const edit = await index.refresh();
    if (index.backlinks("MedBenchmarkFixture/Target.md").length !== 1 || edit.parsed !== 1)
      throw new Error("Edit regression.");
    await unlink(join(fixture, "Source.md"));
    await unlink(join(fixture, "Target.md"));
    const deletion = await index.refresh();
    if (index.backlinks("MedBenchmarkFixture/Target.md").length) throw new Error("Stale backlink.");
    queryMs.sort((a, b) => a - b);
    const rssMiB = process.memoryUsage().rss / 1024 / 1024;
    index.close();
    await writeFile(
      output,
      JSON.stringify(
        {
          initial,
          warm,
          reopened,
          reopenMs,
          edit,
          deletion,
          backlinkQueries: {
            count: queryMs.length,
            rows: backlinkRows,
            p50Ms: queryMs[Math.floor(queryMs.length * 0.5)],
            p95Ms: queryMs[Math.floor(queryMs.length * 0.95)],
          },
          rssMiB,
          databaseBytes: (await stat(database)).size,
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
} else {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const sample = join(dirname(output), `sample-${i}.json`);
    await exec(
      process.execPath,
      [import.meta.filename, "--copy", root, "--output", sample, "--sample", String(i)],
      { maxBuffer: 1024 * 1024, timeout: 120_000 },
    );
    samples.push(JSON.parse(await readFile(sample, "utf8")));
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        runtime: process.versions,
        platform: process.platform,
        architecture: process.arch,
        boundary:
          "CLI index only; fresh databases, filesystem cache not flushed; no browser or watcher",
        exclusions: manifest.exclusions,
        copiedFiles: manifest.files,
        copiedBytes: manifest.bytes,
        samples,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        output,
        samples: samples.map((s) => ({
          initial: s.initial,
          warmMs: s.warm.timings.totalMs,
          editMs: s.edit.timings.totalMs,
          queries: s.backlinkQueries,
          rssMiB: s.rssMiB,
        })),
      },
      null,
      2,
    ),
  );
}
