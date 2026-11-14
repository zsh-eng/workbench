// Project symbols of a checkout (⌘⇧O, Project): the host's read and ranking,
// and a key's time to results in the built app.
//
//   bun run build
//   node scripts/benchmark-working-symbols.mjs <repo> [--cli dist/cli.js] [--source .]
//     [--out .benchmarks/working-symbols.json]
//
// --source is the Med folder whose src/host/search/symbols.ts the host phase
// bundles; --cli is the built CLI that the browser phase starts. Point both at
// another build to compare. The repository is read only.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    cli: { type: "string", default: "dist/cli.js" },
    source: { type: "string", default: "." },
    out: { type: "string", default: ".benchmarks/working-symbols.json" },
  },
});
const repo = realpathSync(resolve(positionals[0] ?? "../.."));
const queries = ["setTimeout", "useState", "parse", "findSymbols"];
await mkdir(".benchmarks", { recursive: true });
const dir = await mkdtemp(resolve(".benchmarks/working-symbols-"));
const summary = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    medianMs: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10,
    p95Ms: Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1] * 10) / 10,
  };
};
const report = { repo, capturedAt: new Date().toISOString(), load: loadavg()[0] };

// The host: Ctags over the working files, then a query with the checkout's
// token unchanged (no Git), and with none (the files listed and checked).
const { build } = await import(
  join(dirname(realpathSync("node_modules/vite")), "rolldown/dist/index.mjs")
);
await build({
  input: resolve(values.source, "src/host/search/symbols.ts"),
  platform: "node",
  external: ["zod"],
  output: { file: join(dir, "symbols.mjs"), format: "esm" },
  logLevel: "silent",
});
const { discoverCtags, WorkingTreeSymbols } = await import(join(dir, "symbols.mjs"));
const tool = await discoverCtags();
if (!tool) throw new Error("Install Universal Ctags before this benchmark.");
const cold = [];
let service;
for (let run = 0; run < 3; run++) {
  service = new WorkingTreeSymbols(tool);
  const start = performance.now();
  await service.search(repo, "", undefined, "token");
  cold.push(performance.now() - start);
}
report.host = { firstRead: summary(cold) };
for (const [name, token] of [
  ["sameToken", "token"],
  ["noToken", undefined],
]) {
  const samples = [];
  for (const query of queries)
    for (let end = 1; end <= query.length; end++) {
      const start = performance.now();
      await service.search(repo, query.slice(0, end), undefined, token);
      samples.push(performance.now() - start);
    }
  report.host[name] = summary(samples);
}

// The app: the picker opens with no file, so it searches the project.
const host = spawn(
  process.execPath,
  [values.cli, repo, "--no-open", "--port", "0", "--state-dir", join(dir, "state")],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      MED_SEARCH_CACHE: join(dir, "search"),
      MED_ZOEKT_BIN: join(dir, "no-search-tools"),
    },
  },
);
const browser = await chromium.launch({ headless: true });
try {
  const url = await new Promise((done, fail) => {
    let output = "";
    host.stdout.on("data", (chunk) => {
      output += chunk;
      const match = /http:\/\/127\.0\.0\.1:\d+\S*/.exec(output);
      if (match) done(match[0]);
    });
    host.once("exit", (code) => fail(new Error(`The host exited with ${code}.`)));
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(url);
  await page.locator('[data-review-status="ready"]:visible').waitFor({ timeout: 60_000 });
  await page.evaluate(() => {
    performance.setResourceTimingBufferSize(100_000);
    document.addEventListener("keydown", () => (window.keyAt = performance.now()), true);
  });
  // From the last key until the list shows the answer to its query.
  const answered = () =>
    page
      .waitForFunction(
        () => {
          const list = document.querySelector('[role="dialog"] [aria-busy]');
          if (list?.getAttribute("aria-busy") !== "false") return false;
          const request = performance
            .getEntriesByType("resource")
            .findLast((entry) => entry.name.endsWith("/api/browse/symbols"));
          return {
            total: performance.now() - window.keyAt,
            request:
              request && request.startTime >= window.keyAt
                ? request.responseEnd - request.startTime
                : undefined,
          };
        },
        undefined,
        { polling: "raf", timeout: 60_000 },
      )
      .then((handle) => handle.jsonValue());
  await page.keyboard.press("Meta+Shift+O");
  const input = page.getByRole("combobox", { name: "Find symbol in project" });
  await input.waitFor();
  report.app = { open: Math.round((await answered()).total) };
  // The checkout's watcher becomes ready.
  await page.waitForTimeout(2000);
  const keys = [];
  const requests = [];
  for (let round = 0; round < 3; round++)
    for (const query of queries) {
      await input.fill("");
      await answered();
      for (const character of query) {
        await page.keyboard.type(character);
        const { total, request } = await answered();
        keys.push(total);
        if (request !== undefined) requests.push(request);
      }
    }
  report.app.key = summary(keys);
  report.app.request = summary(requests);
  // Keys 60 ms apart; Playwright waits its delay after the last key too.
  const typed = [];
  for (let round = 0; round < 5; round++)
    for (const query of queries) {
      await input.fill("");
      await answered();
      await page.keyboard.type(query.slice(0, -1), { delay: 60 });
      await page.keyboard.type(query.slice(-1));
      typed.push((await answered()).total);
    }
  report.app.typedLastKey = summary(typed);
} finally {
  await browser.close();
  const exited = host.exitCode === null ? once(host, "exit") : undefined;
  host.kill();
  await exited;
  await rm(dir, { recursive: true, force: true });
}
await writeFile(values.out, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
