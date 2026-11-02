/**
 * Crash check for a restore: SIGKILL Chrome part way through a restore on a
 * disk profile, open the same profile again, let the restore finish, and
 * compare what is stored with a restore that nobody interrupted. It needs the
 * restore lab's servers, with RESTORE_LAB_API and RESTORE_LAB_APP_ORIGIN set
 * as for `bun run kit time`.
 *
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 bun scripts/idb-lab/crash.ts \
 *     --app https://localhost:5663 --label base --kill 0,2500,6000,10000,13000 \
 *     --rounds 3 --out crash.jsonl
 *
 * A kill of 0 is the restore with no kill. `--grades <n>` grades n cards before
 * the kill, on a RESTORE_LAB_ACCOUNT kept for that, and checks that each graded
 * row is the same when the restore has finished and pushed. This shows a process
 * crash only. The operating system keeps what the browser has written, so it
 * says nothing about a power loss, where relaxed durability could matter.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "../../../../packages/agent-kit/node_modules/@playwright/test/index.js";
import restoreLabDevice from "../../tests/kit/restore-lab-device";

const flag = (name: string, fallback?: string) => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at === -1 ? fallback : process.argv[at + 1];
  if (value === undefined) throw new Error(`Give --${name}`);
  return value;
};
const app = flag("app");
const label = flag("label");
const out = flag("out");
const kills = flag("kill", "0,6000").split(",").map(Number);
const rounds = Number(flag("rounds", "1"));
const grades = Number(flag("grades", "0"));
const STATIC = "/manifest.webmanifest";

const launch = (profile: string) =>
  chromium.launchPersistentContext(profile, {
    headless: true,
    ignoreHTTPSErrors: true,
  });

type Stored = {
  rows: Record<string, number>;
  digest?: string;
  bootstrapped: boolean;
  cursors: string[];
  /** Each outbox key with its stored row, as JSON. */
  pending: Record<string, string>;
  /** The stored row of each key that was asked for, as JSON. */
  looked: Record<string, string>;
};

/** The rows in each store and the sync state, read in the app's origin. */
const readStored = (page: Page, digest: boolean, keys: string[] = []) =>
  page.evaluate(
    async ({ digest, keys }): Promise<Stored> => {
      const state = Object.keys(localStorage)
        .filter((key) => key.startsWith("spaced-records-v3-state"))
        .map((key) => localStorage.getItem(key)!);
      const name = (await indexedDB.databases())
        .map((db) => db.name)
        .find((candidate) => candidate?.startsWith("SpacedRecordsV3"));
      const result: Stored = {
        rows: {},
        bootstrapped: state.some((value) =>
          value.includes('"bootstrapped":true'),
        ),
        cursors: state.map((value) => value.slice(0, 200)),
        pending: {},
        looked: {},
      };
      if (!name) return result;
      const db = await new Promise<IDBDatabase>((done, fail) => {
        const open = indexedDB.open(name);
        open.onsuccess = () => done(open.result);
        open.onerror = () => fail(open.error);
      });
      const stores = [...db.objectStoreNames];
      const tx = db.transaction(stores);
      const read = <T>(request: IDBRequest<T>) =>
        new Promise<T>((done, fail) => {
          request.onsuccess = () => done(request.result);
          request.onerror = () => fail(request.error);
        });
      const parts: string[] = [];
      for (const store of stores) {
        const target = tx.objectStore(store);
        result.rows[store] = await read(target.count());
        if (digest && store !== "metadataKv")
          parts.push(store, JSON.stringify(await read(target.getAll())));
      }
      const rowOf = async (key: string) => {
        const [table, id] = JSON.parse(key) as [string, string];
        return JSON.stringify(await read(tx.objectStore(table).get(id)));
      };
      const outbox = tx.objectStore("_sync_outbox");
      for (const { key } of await read(outbox.getAll()))
        result.pending[key] = await rowOf(key);
      for (const key of keys) result.looked[key] = await rowOf(key);
      db.close();
      if (digest) {
        const hash = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(parts.join("\n")),
        );
        result.digest = [...new Uint8Array(hash)]
          .slice(0, 8)
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
      }
      return result;
    },
    { digest, keys },
  );

/** Ends every process of this profile at once. The path is ours alone. */
const killProfile = (profile: string) => {
  const found = spawnSync("pgrep", ["-f", profile]).stdout.toString().trim();
  for (const pid of found ? found.split("\n") : []) {
    try {
      process.kill(Number(pid), "SIGKILL");
    } catch {
      // Its parent's exit may have ended it already.
    }
  }
};

/** Playwright's close can stay pending under Bun, so it gets a limit. */
const closeBrowser = async (context: BrowserContext) => {
  let timer: Timer;
  await Promise.race([
    context.close().catch(() => {}),
    new Promise((done) => (timer = setTimeout(done, 5_000))),
  ]);
  clearTimeout(timer!);
};

const within = <T>(ms: number, work: Promise<T>) => {
  let timer: Timer;
  return Promise.race([
    work,
    new Promise<never>((_, fail) => {
      timer = setTimeout(() => fail(new Error(`No answer in ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

/** The profile of the run in progress, for a run that gives no answer. */
let current: string | undefined;

async function run(kill: number) {
  const profile = mkdtempSync(join(tmpdir(), "idb-lab-crash-"));
  current = profile;
  try {
    // Sign in first and close cleanly, so the cookie is on disk before the kill.
    const first = await launch(profile);
    const signIn = first.pages()[0] ?? (await first.newPage());
    await restoreLabDevice({ page: signIn, context: first, baseURL: app });
    await signIn.goto("about:blank");
    const cdp = await first.newCDPSession(signIn);
    await cdp.send("Storage.clearDataForOrigin", {
      origin: app,
      storageTypes: "indexeddb,local_storage,cache_storage,service_workers",
    });
    await closeBrowser(first);
    killProfile(profile);

    const second = await launch(profile);
    const page = second.pages()[0] ?? (await second.newPage());
    const start = Date.now();
    await page.goto(`${app}/`);
    const good = page.locator("main button", { hasText: "Good" }).first();
    for (let graded = 0; graded < grades; graded += 1) {
      await good.click({ timeout: 60_000 });
      await page.waitForTimeout(200);
    }
    let beforeKill: Stored | undefined;
    if (kill) {
      await page.waitForTimeout(Math.max(0, kill - (Date.now() - start)));
      beforeKill = await readStored(page, false);
      killProfile(profile);
      await closeBrowser(second);
    } else await waitForRestore(page);
    const restoredAt = Date.now() - start;

    const third = kill ? await launch(profile) : second;
    const again = third.pages()[0] ?? (await third.newPage());
    let survived: Stored | undefined;
    let finishMs = 0;
    if (kill) {
      await again.goto(`${app}${STATIC}`);
      survived = await readStored(again, false);
      const resumed = Date.now();
      await again.goto(`${app}/`);
      await waitForRestore(again);
      finishMs = Date.now() - resumed;
    }
    const graded = Object.keys(beforeKill?.pending ?? {});
    let final = await readStored(again, true, graded);
    // The graded rows stay in the outbox until the restore's push.
    for (let tries = 0; final.rows._sync_outbox && tries < 60; tries += 1) {
      await again.waitForTimeout(500);
      final = await readStored(again, true, graded);
    }
    const kept = graded.filter(
      (key) => final.looked[key] === beforeKill!.pending[key],
    ).length;
    await closeBrowser(third);
    return {
      label,
      kill,
      restoredAt,
      finishMs,
      beforeKill,
      survived,
      final,
      graded: graded.length,
      kept,
    };
  } finally {
    killProfile(profile);
    rmSync(profile, { recursive: true, force: true });
  }
}

const waitForRestore = (page: Page) =>
  page.waitForFunction(
    () =>
      Object.keys(localStorage).some(
        (key) =>
          key.startsWith("spaced-records-v3-state") &&
          localStorage.getItem(key)!.includes('"bootstrapped":true'),
      ),
    undefined,
    { timeout: 180_000, polling: 100 },
  );

for (let round = 0; round < rounds; round += 1)
  for (const kill of kills) {
    try {
      const result = await within(300_000, run(kill));
      appendFileSync(out, `${JSON.stringify({ round, ...result })}\n`);
      console.log(
        label,
        "kill",
        kill,
        "before",
        JSON.stringify(result.beforeKill?.rows),
        "survived",
        JSON.stringify(result.survived?.rows),
        "bootstrapped",
        result.survived?.bootstrapped,
        "finish",
        result.finishMs,
        "final",
        JSON.stringify(result.final.rows),
        result.final.digest,
        grades ? `graded ${result.graded} kept ${result.kept}` : "",
      );
    } catch (error) {
      const failed = String(error).slice(0, 300);
      appendFileSync(
        out,
        `${JSON.stringify({ round, label, kill, failed })}\n`,
      );
      console.log(label, "kill", kill, "failed:", failed);
      if (current) {
        killProfile(current);
        rmSync(current, { recursive: true, force: true });
      }
    }
  }
process.exit(0);
