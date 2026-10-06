import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const origin = "http://127.0.0.1:" + (process.env.OPFS_REPEAT_PORT ?? "5403");
const rounds = Number(process.env.OPFS_REPEAT_ROUNDS ?? 5);
const configuredEngines = (
  process.env.OPFS_REPEAT_ENGINES ?? "dexie,native-idb,opfs,native-idb-strict"
).split(",");
const configuredScopes = process.env.OPFS_REPEAT_SCOPES?.split(",");
const output =
  process.env.OPFS_REPEAT_RESULTS ??
  "cutover.local/storage-benchmark/opfs-repeat-aggregate-" +
    Date.now() +
    ".json";
let context, profile, version;
try {
  if (!(await fetch(origin + "/claim", { method: "POST" })).ok)
    throw Error("Benchmark already claimed");
  for (let round = 0; round < rounds; round++) {
    profile = await mkdtemp(join(tmpdir(), "spaced-opfs-persistent-"));
    context = await chromium.launchPersistentContext(profile, {
      channel: "chrome",
      headless: true,
    });
    version = context.browser().version();
    let page = await context.newPage();
    await page.goto(origin);
    const marker = crypto.randomUUID();
    await profileProbe(page, marker, true);
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      channel: "chrome",
      headless: true,
    });
    page = await context.newPage();
    await page.goto(origin);
    await profileProbe(page, marker, false);
    console.log(
      "Persistent Chrome " +
        version +
        "; IndexedDB probe survived browser restart",
    );
    page.on("pageerror", (e) => console.error("Page error", e.message));
    await page.goto(origin);
    const engines = configuredEngines;
    const order = [
      ...engines.slice(round % engines.length),
      ...engines.slice(0, round % engines.length),
    ];
    for (const scope of configuredScopes ??
      (round % 2 ? ["main", "all"] : ["all", "main"]))
      for (const engine of order) {
        let waited = 0,
          before;
        while (true) {
          before = (await (await fetch(origin + "/load")).json()).load;
          const building = /swift-frontend|swift-build|xcodebuild/.test(
            execFileSync("ps", ["-axo", "comm"], { encoding: "utf8" }),
          );
          if (!building && before[0] <= 8) break;
          if (waited >= 1200000)
            throw Error("Host did not settle within 20 minutes");
          console.log(
            "Waiting for quiet host " +
              JSON.stringify({ building, load: before }),
          );
          await new Promise((r) => setTimeout(r, 10000));
          waited += 10000;
        }
        console.log(
          "Starting " +
            JSON.stringify({ round: round + 1, engine, scope, load: before }),
        );
        const sample = await page.evaluate(
          async ({ engine, scope, round }) => {
            const job = (c) =>
              new Promise((resolve, reject) => {
                const w = new Worker("/worker.js", { type: "module" });
                const timer = setTimeout(() => {
                  w.terminate();
                  reject(Error("Worker timeout"));
                }, 240000);
                w.onmessage = ({ data }) => {
                  clearTimeout(timer);
                  w.terminate();
                  data.ok
                    ? resolve(data)
                    : reject(Error(data.error + "\n" + data.stack));
                };
                w.onerror = (e) => {
                  clearTimeout(timer);
                  w.terminate();
                  reject(Error(e.message));
                };
                w.postMessage(c);
              });
            const c = {
              engine,
              scope,
              round,
              batch: 5000,
              idbDurability:
                engine === "native-idb-strict" ? "strict" : "default",
              name: "SpacedOPFSBench-" + crypto.randomUUID(),
            };
            const start = performance.now();
            const write = await job({ ...c, mode: "write" });
            const verify = await job({ ...c, mode: "verify" });
            const sample = {
              ...write,
              ...verify,
              round,
              caseWallMs: performance.now() - start,
            };
            delete sample.name;
            return sample;
          },
          { engine, scope, round: round + 1 },
        );
        sample.hostLoadBefore = before;
        sample.profileSurvivesBrowserRestart = true;
        const res = await fetch(origin + "/sample", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sample),
        });
        if (!res.ok) throw Error("Failed to save verified sample");
        const points = sample.pointResults.map((p) => {
          const v = [...p.latenciesMs].sort((a, b) => a - b);
          return { workload: p.workload, p50: v[49], p95: v[94], max: v[99] };
        });
        console.log(
          JSON.stringify({
            round: round + 1,
            engine,
            scope,
            writeMs: sample.writeMs,
            prepareMs: sample.prepareMs,
            setupMs: sample.setupMs,
            pointWrites: points,
            verified: true,
          }),
        );
      }
    await context.close();
    context = undefined;
    await rm(profile, { recursive: true, force: true });
    profile = undefined;
  }
  await fetch(origin + "/complete", { method: "POST" });
  const results = await (await fetch(origin + "/results")).json();
  results.browser = version;
  results.runner =
    "Dedicated headless installed Chrome; fresh persistent disk profile each round, proven by IndexedDB probe across browser restart; fresh worker and database each case; host load limit 8";
  await writeFile(output, JSON.stringify(results, null, 2) + "\n");
  console.log("COMPLETE " + results.samples.length + " samples");
} finally {
  await context?.close();
  if (profile)
    console.error("Retained failed-run profile for diagnosis: " + profile);
}

async function profileProbe(page, marker, write) {
  await page.evaluate(
    async ({ marker, write }) => {
      const req = indexedDB.open("SpacedBenchmarkProfileProbe", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("probe");
      const db = await new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction("probe", write ? "readwrite" : "readonly");
      const done = new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
      if (write) tx.objectStore("probe").put(marker, "marker");
      else {
        const get = tx.objectStore("probe").get("marker");
        const found = await new Promise((resolve, reject) => {
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        });
        if (found !== marker)
          throw Error(
            "Persistent-profile probe did not survive browser restart",
          );
      }
      await done;
      db.close();
      if (!write)
        await new Promise((resolve, reject) => {
          const d = indexedDB.deleteDatabase("SpacedBenchmarkProfileProbe");
          d.onsuccess = resolve;
          d.onerror = () => reject(d.error);
        });
    },
    { marker, write },
  );
}
