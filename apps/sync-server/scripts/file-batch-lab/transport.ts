/**
 * Compares ways to fetch an account's Arctic texts from the lab API
 * (worker.ts), without a browser: one request per file at a given
 * concurrency (with the CORS preflight that a browser sends for each new
 * URL), or batches through `downloadFiles`. Each request waits one round
 * trip first, as over HTTP/2 to a colo. Node's fetch opens as many
 * connections as asked, as HTTP/2 multiplexes as many streams.
 *
 *   bun scripts/file-batch-lab/transport.ts --n 200 --profile far \
 *     --pattern single --parallel 32
 *
 * Needs an account that bench.ts seeded (`--app arctic --seed`).
 */
import { downloadFiles } from "@workbench/file-batch";

const options = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split(/\s*--/)
    .filter(Boolean)
    .map((part) => part.split(" ") as [string, string]),
);
const api = options.api ?? "http://localhost:5501";
if (!["localhost", "127.0.0.1"].includes(new URL(api).hostname))
  throw new Error("The lab runs against a local API only");
const n = Number(options.n ?? 50);
const parallel = Number(options.parallel ?? 6);
const pattern = options.pattern ?? "batch";
const PROFILES = {
  near: { rttMs: 25, d1Ms: 30, r2Ms: 135 },
  far: { rttMs: 320, d1Ms: 170, r2Ms: 550 },
};
const profile = PROFILES[(options.profile ?? "near") as keyof typeof PROFILES];
const origin = "http://localhost:5502";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const signIn = await fetch(`${api}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({
    email: `lab-arctic-${n}@example.test`,
    password: "file-batch-lab-password",
  }),
});
if (!signIn.ok) throw new Error("Sign-in failed; seed the account first");
const cookie = signIn.headers
  .getSetCookie()
  .map((value) => value.split(";")[0])
  .join("; ");
const base = `${api}/api/apps/arctic-content`;
const scope = JSON.stringify(
  await (
    await fetch(`${base}/sync/v3/state`, { headers: { Cookie: cookie } })
  ).json(),
);
const headers = { Cookie: cookie, Origin: origin, "X-Sync-Scope": scope };
// The text records name the files.
const ids: string[] = [];
for (let cursor = 0; ; ) {
  const page = (await (
    await fetch(
      `${base}/sync/v3/pull?cursor=${cursor}&excludeOwnDevice=false&limit=500`,
      { headers: { ...headers, "X-Device-ID": "lab-transport" } },
    )
  ).json()) as {
    records: { value: string }[];
    cursor: number;
    hasMore: boolean;
  };
  for (const record of page.records)
    ids.push((JSON.parse(record.value) as { file: string }).file);
  if (!page.hasMore) break;
  cursor = page.cursor;
}

/** One request as the browser sends it: a round trip, then the answer. */
let requests = 0;
async function send(url: string, init: RequestInit = {}) {
  requests++;
  await sleep(profile.rttMs);
  return fetch(url, { ...init, headers: { ...headers, ...init.headers } });
}
const preflight = (url: string, method: string) =>
  send(url, {
    method: "OPTIONS",
    headers: {
      "Access-Control-Request-Method": method,
      "Access-Control-Request-Headers": "content-type,x-sync-scope",
    },
  }).then((r) => r.arrayBuffer());

await fetch(`${api}/__lab`, { method: "POST", body: JSON.stringify(profile) });
let bytes = 0;
const t0 = performance.now();
try {
  if (pattern === "single") {
    const queue = [...ids];
    await Promise.all(
      Array.from({ length: parallel }, async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
          const url = `${base}/files/${id}`;
          await preflight(url, "GET");
          const response = await send(url);
          if (!response.ok) throw new Error(`${id}: ${response.status}`);
          const file = await response.arrayBuffer();
          bytes += file.byteLength;
        }
      }),
    );
  } else {
    // The browser caches the batch route's one preflight.
    await preflight(`${base}/files/batch`, "POST");
    await downloadFiles({
      ids,
      parallel,
      fetchBatch: (batch, signal) =>
        send(`${base}/files/batch`, {
          method: "POST",
          body: JSON.stringify({ ids: batch }),
          headers: { "Content-Type": "application/json" },
          signal,
        }),
      fetchOne: (id, signal) => send(`${base}/files/${id}`, { signal }),
      store: async (_id, file) => {
        bytes += file.byteLength;
      },
    });
  }
} finally {
  await fetch(`${api}/__lab`, {
    method: "POST",
    body: JSON.stringify({ d1Ms: 0, r2Ms: 0 }),
  });
}
console.log(
  JSON.stringify({
    pattern,
    parallel,
    n: ids.length,
    profile: options.profile ?? "near",
    ms: Math.round(performance.now() - t0),
    bytes,
    requests,
  }),
);
